# 通信协议

源码：`desktop/src/api.ts`、`types.ts`、`desktop/src-tauri/src/main.rs`、`resource-core/desktop-bridge.js`、`batch.js`。本页描述新契约，不支持旧 compress mode、扁平 options 或 modules 定义。

## 原生和 JSON Lines

前端 `invoke('core_call', {action, payload})` 经 Rust 转为一行 `{id, action, payload}`；Node 回一行 `{id, result}` 或 `{id, error}`。stdout 不允许其他日志。`open_report({id})` 由 Rust 验证本次作业报告目录再打开。目录选择使用 Tauri dialog 插件。

| action | payload | 结果 |
| --- | --- | --- |
| bootstrap | 空对象 | config、definition、warnings、configError、root、nodeVersion |
| normalize / save | Configuration | 规范化配置；save 原子保存后返回 |
| tasks | 空对象 | 持久任务摘要数组 |
| start | JobRequest | `{id}` 临时作业会话 |
| poll | `{id}` | JobState，进程退出才最终 done |
| cancel | `{id}` | `{requested:true}`，协作取消 |
| report | `{id}` | 已结束作业的报告目录 |

Configuration 的 `schema` 为 `asset-toolbox.settings/1`，含 sourceDir/outputDir/backupDir、saveMode、backupEnabled、pipeline。Definition 的 `apiVersion:1`，含 resourceTypes/operations/providers；参数字段描述及步骤结构见[扩展契约](extensions.md)。

## 作业模式

| mode | 必需内容 | 行为 |
| --- | --- | --- |
| preview / process | folder、pipeline | 扫描预览 / 建立持久处理任务；可选 outputDir 或 backupDir |
| resume / retry | taskFile | 继续 pending / 重试 failed，固定原任务快照与版本 |
| restore-preview | taskFile | 返回任务备份的可恢复项与冲突 |
| restore / restore-retry | taskFile、可选 selection | 恢复或重试恢复 |
| restore-export-preview | backupDir、outputDir | 检查独立备份及目标 |
| restore-export | backupDir、outputDir、可选 selection | 导出独立备份 |

桌面恢复总是显式传 selection；省略表示 CLI 默认范围，`[]` 表示空范围，不能互换。每项含相对 path、backupHash、targetHash（目标不存在时 null），执行前重新校验。恢复与任务浏览无需加载提供方。

最小新请求：

```json
{"mode":"process","folder":"D:\\Assets","outputDir":"D:\\Results","pipeline":[{"id":"resize","resourceType":"png","operation":"image-resize","provider":"sharp","enabled":true,"parameters":{"width":256,"height":256},"providerOptions":{}}]}
```

## 状态和错误

JobState 含 phase、done、processed（本次已检查/尝试的文件数）、total、current；可能含 message、error、cancelled、summary、task、preview、reportDirectory、reportWarning、recoveryWarnings。phase 为 starting/scanning/checking/processing/restoring/finished。

`summary.processed` 表示实际改变的文件数，与顶层 processed 不同；summary 还有 skipped、failed、copied、backedUp、savedBytes（可负），恢复使用 restored/restoredBytes。处理预览按 `resources` 返回分组，恢复预览按 files 返回文件状态和哈希。任务事件和报告记录 resourceType 与每步状态，不使用旧 module/compressed 字段。

exitCode：0 成功，1 错误，2 取消（存在文件错误时优先 1）；原生预览的冲突/依赖问题通过 issues 显示，直接 CLI 对非空 issues 返回 1。参数错误在 start 前拒绝；运行错误通过 state.error 或逐文件记录呈现。保存报告失败用 reportWarning，不抹掉处理结果。

同一桥接只允许一个活动作业。会话失效后用 tasks 返回的 taskFile 继续，不复用旧会话 ID。测试：核心 desktop/batch、前端组件及 native.spec.ts。
