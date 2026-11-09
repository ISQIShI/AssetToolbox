# 桌面通信协议

协议实现位于 `desktop/src/api.ts`、`desktop/src-tauri/src/main.rs`、`resource-core/desktop-bridge.js` 和 `resource-core/batch.js`。前端类型集中在 `desktop/src/types.ts`，是消费侧声明，不代替 Node 的运行时校验。

## Tauri 与 JSON Lines

前端通过 `core_call(action, payload)` 调用 Node，或通过 `open_report(id)` 打开报告目录。目录选择由 dialog 插件提供，不走 Node action。

Rust 与 Node 桥接进程通过 UTF-8 stdin/stdout 逐行传递 JSON：

```json
{"id":1,"action":"tasks","payload":{}}
{"id":1,"result":[]}
{"id":2,"error":"未知桌面操作：example"}
```

每行一个完整消息。Rust 生成递增 ID 并核对响应，持锁串行调用；错误映射为 Tauri 调用失败。Node 将 `console.log` 转到 stderr，stdout 只用于协议。不得向 stdout 输出调试文字。

## action 契约

| action | payload | result 与副作用 |
| --- | --- | --- |
| `bootstrap` | 空对象 | `{config, definition, warnings, configError, root, nodeVersion}`；读取配置与模块，不保存 |
| `tasks` | 空对象 | 持久任务摘要数组，按 ID 倒序；单个损坏任务返回错误条目 |
| `normalize` | 内存配置对象，`version: 1` | 校验配置、去除路径外层引号，将相对路径按工具根目录解析；不写入 |
| `save` | 同上 | 规范化后保存拆分配置，返回规范化配置 |
| `start` | 下表中的作业请求 | `{id: UUID}`，创建临时目录并启动工作进程 |
| `poll` | `{id}` | 当前 `JobState`；只有进程退出后才可能 `done: true` |
| `cancel` | `{id}` | `{requested: true}`，写取消标记，返回不代表已经停止 |
| `report` | `{id}` | 当前已完成作业的报告目录字符串；未完成或无报告时报错 |

未知 action、未知 mode、无效会话 ID 均拒绝。`start` 对新压缩/扫描先验证源路径字符串和模块参数；实际根目录与持久文件检查由工作进程继续完成。

## 作业请求

| mode | 主要字段 | 行为 |
| --- | --- | --- |
| `preview` | `folder, options, outputDir? / backupDir?` | 压缩扫描预览 |
| `compress` | 同上 | 新压缩，建立持久任务和报告 |
| `resume` | `taskFile` | 使用旧任务参数，处理未完成项 |
| `retry` | `taskFile` | 使用旧任务参数，仅重试压缩失败项 |
| `restore-preview` | `taskFile` | 只读核对任务备份及目标 |
| `restore-export-preview` | `backupDir, outputDir` | 只读核对旧备份导出 |
| `restore` | `taskFile, selection?` | 恢复任务中的所选/未完成项 |
| `restore-retry` | `taskFile, selection?` | 仅重试恢复失败项 |
| `restore-export` | `backupDir, outputDir, selection?` | 导出无任务记录的备份 |

`options` 只含模块字段，不能夹带 `sourceDir`、`saveMode` 等公共配置。`outputDir` 与 `backupDir` 在压缩请求中互斥。续压/重试不接受界面当前参数替换旧任务快照。

桌面恢复流程总是先预览，再显式传入 `selection`：

```text
selection = [{ path: 相对路径, backupHash: 64位小写SHA256, targetHash: SHA256或null }]
```

`targetHash: null` 表示预览时目标不存在。空数组表示不恢复任何文件；省略字段有兼容语义：任务恢复沿用上次选择或旧任务全部备份范围，旧备份导出则扫描全部文件。不得把空数组改写为省略字段。

界面的“继续恢复/重试恢复”先设置 scope 重新预览，随后发送普通 `restore + selection`。`restore-retry` 仍用于 CLI/API 的失败项重试；不要假定按钮名称与底层 mode 一一相同。

## 进度、错误和结束

`JobState` 的稳定基础字段为 `done`、`phase`、`processed`、`total`；按阶段附带 `current`、`elapsedSeconds`、`message`、`preview`、`summary`、`task` 等。阶段包含 `starting`、`scanning`、`checking`、`compressing`、`restoring`、`finished`。扫描中的 `found` 是当前已发现数量，不能当作最终总数。

- `error`：作业级异常；单文件失败通常计入 `summary.failed` 和报告明细。
- `reportWarning`：报告写入失败，不改变已完成素材处理结果。
- `recoveryWarnings`：恢复中断提交状态时发现备份异常等提示。
- `exitCode`：处理成功为 0，失败为 1，取消为 2；处理失败优先于取消。
- `done`：作业已停止，不等于所有文件成功，也不等于持久任务没有待处理项。

预览需要单独解释：桌面压缩预览完成返回 0，即使 `preview.issues` 包含问题；取消返回 2。直接 `compress.js --preview` 则在 `issues` 非空时返回 1。恢复预览可能在正常完成时包含 conflict，调用方应读取预览分类，不能只看退出码。桌面 EXE 的退出码不是最后一次任务的业务退出码。

## CLI 与临时文件

`compress.js` 支持 `--output`、`--backup`、`--preview` 及自动生成的模块参数，也支持 `--options-file`/`--options-base64` 参数载荷；载荷与单独模块参数不能混用。CLI 相对路径按调用者工作目录解析。直接压缩不自动建立任务或报告。

`batch.js` 接受请求文件，或 `--resume`、`--retry`、恢复系列参数；恢复写操作可带 `--selection <文件>`。`tasks.js --list` 列出任务，`settings.js` 提供加载、描述、规范化与保存辅助入口。旧 WinForms/PowerShell 启动通道已经移除，不应为其新增功能。

桥接临时文件由程序自己生成，素材写入不在此目录。详情见[持久化](persistence.md)。变更 action、payload、mode 或状态字段时，同步更新 Node 校验、Rust 包装、TypeScript 类型、协议文档和相关测试。
