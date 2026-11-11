# 通信协议

源码：`desktop/src/core/api.ts`、`core/types.ts`、`desktop/src-tauri/src/main.rs`、`resource-core/desktop-bridge.js`、`batch.js`、`framework/dependencies/worker.js`。本页描述新契约，不支持旧 compress mode、扁平 options 或 modules 定义。

## 原生和 JSON Lines

前端 `invoke('core_call', {action, payload})` 经 Rust 转为一行 `{id, action, payload}`；Node 回一行 `{id, result}` 或 `{id, error}`。stdout 不允许其他日志。`open_report({id})` 由 Rust 验证本次作业报告目录再打开。目录选择使用 Tauri dialog 插件。

| action | payload | 结果 |
| --- | --- | --- |
| bootstrap | 空对象 | config、definition、warnings、configError、root、nodeVersion |
| normalize / save | Configuration | 规范化配置；save 原子保存后返回 |
| providers | 空对象 | 提供方目录及实时 availability/acquisition/dependency，不保存配置或下载 |
| provider-source | `{id}` 提供方 ID | 已登记的 HTTPS 获取地址，未知 ID 拒绝 |
| tasks | 空对象 | 持久任务摘要数组 |
| start | JobRequest | `{id}` 临时作业会话 |
| poll | `{id}` | JobState，进程退出才最终 done |
| cancel | `{id}` | `{requested:true}`，协作取消 |
| report | `{id}` | 已结束作业的报告目录 |

Configuration 的 `schema` 为 `asset-toolbox.settings/2`，含 sourceDir/outputDir/backupDir、saveMode、backupEnabled、pipeline。Definition 的 `apiVersion:3`，含 resourceTypes/operations/providers；Provider 返回生成的 supports 及 `adapters: [{operation, version, fields}]`，不再返回顶层 fields。操作 fields 定义公共参数，选中适配器 fields 定义专属参数。步骤 versions 增加 adapter；旧配置和旧处理快照拒绝，不自动转换，见[扩展契约](extensions.md)。

## 作业模式

| mode | 必需内容 | 行为 |
| --- | --- | --- |
| preview / process | folder、pipeline | 扫描预览 / 建立持久处理任务；可选 outputDir 或 backupDir |
| resume / retry | taskFile | 继续 pending / 重试 failed，固定原任务快照与版本 |
| restore-preview | taskFile | 返回任务备份的可恢复项与冲突 |
| restore / restore-retry | taskFile、可选 selection | 恢复或重试恢复 |
| restore-export-preview | backupDir、outputDir | 检查独立备份及目标 |
| restore-export | backupDir、outputDir、可选 selection | 导出独立备份 |
| dependency-install | providerId | 从内置清单安装/更新依赖；只允许 mode 和 providerId 两个字段，不接受 URL/路径/命令 |

桌面恢复总是显式传 selection；省略表示 CLI 默认范围，`[]` 表示空范围，不能互换。每项含相对 path、backupHash、targetHash（目标不存在时 null），执行前重新校验。恢复与任务浏览无需加载提供方。

最小新请求：

```json
{"mode":"process","folder":"D:\\Assets","outputDir":"D:\\Results","pipeline":[{"id":"resize","resourceType":"png","operation":"image-resize","provider":"sharp","enabled":true,"parameters":{"width":256,"height":256},"providerOptions":{}}]}
```

## 状态和错误

JobState 含 phase、done、processed（本次已检查/尝试的文件数）、total、current；可能含 message、error、cancelled、summary、task、preview、reportDirectory、reportWarning、recoveryWarnings。phase 为 starting/scanning/checking/processing/restoring/finished。

依赖作业增加 downloading/verifying/installing 阶段，processed/total 表示已完成包数/总包数，current 为当前下载来源，message 为安装进度或结果；不创建素材任务、报告或 summary。完成后前端刷新 providers，取消仍经 cancel，进程退出后才最终 done。

Provider.dependency 包含 automatic、reason；自动计划还含 targetVersion、checkedAt、sources、可选 installedVersion、state（missing/unmanaged/current/update/damaged）及 action（install/update/repair/reinstall）。更新受当前核验清单约束，见[依赖管理](dependencies.md)。

`summary.processed` 表示实际改变的文件数，与顶层 processed 不同；summary 还有 skipped、failed、copied、backedUp、savedBytes（可负），恢复使用 restored/restoredBytes。处理预览按 `resources` 返回分组，恢复预览按 files 返回文件状态和哈希。任务事件和报告记录 resourceType 与每步状态，不使用旧 module/compressed 字段。

exitCode：0 成功，1 错误，2 取消（存在文件错误时优先 1）；原生预览的冲突/依赖问题通过 issues 显示，直接 CLI 对非空 issues 返回 1。参数错误在 start 前拒绝；运行错误通过 state.error 或逐文件记录呈现。保存报告失败用 reportWarning，不抹掉处理结果。

同一桥接只允许一个活动作业。会话失效后用 tasks 返回的 taskFile 继续，不复用旧会话 ID。测试：核心 desktop/batch、前端组件及 native.spec.ts。

原生 `open_provider_source({id})` 从核心读取登记地址并在默认浏览器打开；前端不能传任意 URL。缺失依赖的启用步骤阻止“开始处理”，预览和无关功能仍可使用。

## 音频结果

目录 operations 增加 `observe` 策略和 `preserveOriginal`。纯分析请求不需要 outputDir/backupDir，前端不发送记忆中的路径；受保护转换必须另存或备份。JobState 完成状态可含 `audioResults`（前 100 条）及 `audioResultCount`（全量条数），每项有 path/operation/status/fileStatus、before/after 测量、请求/实际增益、目标/是否达到、limited/warnings/message。null 表示无法测量，不显示为 0。完整字段与输出边界见[音频专题](audio.md)。文件 failed 时测量来自未提交的中间步骤；纯分析 summary.skipped 增加，processed 不增加。
