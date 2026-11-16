# 通信协议

桌面、CLI、MCP（stdio/Streamable HTTP）及 HTTP 使用同一[应用 /8 契约](application.md)。本页补充桌面传输与原生能力；公共动作、请求和错误码见[自动化接口](automation.md)，HTTP 认证与路径见 [HTTP 专题](http.md)。

源码：`desktop/src/core/{api,types,workbench}.ts`、`desktop/src-tauri/src/main.rs`、`resource-core/desktop-bridge.js`、`application/{contract,service,desktop-actions}.js`。

## 原生和 JSON Lines

前端 `invoke('core_call', {action,payload})` 经 Rust 转为一行 `{id,action,payload}`。Node 调用公共 respond，返回 `{id,schema:"asset-toolbox.response/8",ok:true,result}` 或 `{id,schema,ok:false,error:{code,message}}`。Rust 核对关联 id 和响应版本后解包；失败向前端返回带错误码的消息。stdout 只能写协议。

| 公共 action | payload | 返回 |
| --- | --- | --- |
| capabilities | `{}` | 目录、应用版本、输入 schema 和当前 policy |
| validate | `{request}` | 规范化公共请求 |
| submit | `{request,idempotencyKey}` | `{jobId,replayed}` |
| status | `{jobId}` | 持久作业状态；工作进程退出才最终 done |
| cancel | `{jobId}` | `{jobId,requested:true}` |
| results | `{jobId,kind?,offset?,limit?}` | files/audio/restore 分页明细 |
| jobs / tasks | `{offset?,limit?}` | 当前权限可见的分页摘要 |
| storage-preview | `{retentionDays?,offset?,limit?}` | 本地存储维护预览；默认保留 30 天 |
| storage-clean | `{retentionDays,selection:[{jobId,fingerprint}]}` | 本地逐项清理结果；必须显式选择 |

这些动作直接进入 ApplicationService，桥接没有公共作业分支。桌面以任务 id 选中、续跑和恢复；不传 taskFile。旧 start/poll、临时作业 ID 和 /1、/2、/3 响应不支持，不做兼容映射。

## 桌面专属能力

以下由启用 settings 能力的本地上下文调用，HTTP/MCP 不公开；实现不访问 JobSession。

| action | payload | 返回 |
| --- | --- | --- |
| bootstrap | `{}` | config、definition、warnings、configError、root、nodeVersion |
| normalize / save | Configuration | 规范化配置；save 原子保存 |
| providers | `{}` | 公共目录中的提供方列表和实时依赖状态 |
| provider-source | `{id}` | 已登记的 HTTPS 来源，未知 ID 拒绝 |
| report | `{jobId}` | 应用服务验证过的已完成作业报告目录 |

原生 `open_report({id})` 将持久 jobId 映射为 report 请求，再打开已核验目录；前端不能提供报告路径。`open_provider_source({id})` 从核心读取登记 URL，只接受 HTTPS。选择目录使用 Tauri dialog，不属于作业请求。

Configuration 仍为 `asset-toolbox.settings/3`，Definition 仍为目录 API 4；资源类型、操作与提供方 API 不变，见[扩展契约](extensions.md)。配置损坏或提供方缺失时，任务浏览及哈希恢复仍可使用。

## 作业与结果

preview/process 使用 folder、pipeline 及可选 outputDir 或 backupDir。resume/retry/restore-preview 使用 taskId；restore/restore-retry 还必须提供非空 selection。restore-export-preview/export 使用 backupDir/outputDir，实际导出同样必须提供 selection。dependency-install 只能指定 providerId，不接受 URL、路径、命令或摘要。

selection 每项含相对 path、backupHash、targetHash（目标不存在时 null），来自 results 的 restore 预览。省略和空数组均拒绝，执行前重新验证哈希。普通 preview 只扫描，音频分析通过 audio-analyze 执行。

JobState 包含 jobId、phase、done、processed、total、hasReport；可含 current、message、error/errorCode、cancelled、summary、task/taskId、preview、报告警告及恢复警告。不返回 taskFile 或 reportDirectory。预览的汇总放在 status，恢复文件清单由 results 分页取得。

processed 表示本次检查/尝试数；summary.processed 才是实际改变数。依赖安装增加 downloading/verifying/installing 阶段，processed/total 表示包数，不创建素材任务和报告。安装完成后前端刷新 providers；来源、摘要及目录保护见[依赖管理](dependencies.md)。

音频 status 可保留最多 100 条测量作为报告失败时的提示；正常完成后桌面通过 results/audio 获取前 100 条，全量结果分页可读。未提交的测量、null 值及元数据损失必须可见，见[音频专题](audio.md)。

exitCode 为 0 完成、1 失败、2 取消（失败优先）；CLI 也将预览 issues 反映到退出码。公共参数错误在提交前拒绝；运行错误保留在作业状态/文件结果。报告保存失败仅产生 reportWarning，不抹掉已完成处理。

## 生命周期和验证

桌面、CLI 和 stdio MCP 使用 connection 生命周期，拥有会话关闭时请求取消自己启动的活动作业；HTTP 使用 server 生命周期，客户端断开不取消。所有入口共享执行互斥；公共记录重启后仍可查询，跨入口读取/取消须再次通过当前权限。

验证：核心 application/unified/desktop/http，MCP 官方客户端五入口联合测试，前端组件测试，以及真实 EXE 与 CLI 状态一致、重启查询、安装/音频/恢复等原生 E2E。实际结果见[项目状态](../project-status.md)。

清理后的状态包含 resultsExpired/cleanedAt，hasReport 为 false；results/report 返回 RESULTS_EXPIRED，过期清理预览返回 STALE_PREVIEW。新 retention/1 侧文件不改变 job/6；详细权限和原子记录语义见[存储维护](storage.md)。

## 排队状态

应用及响应 /8、job/6。status 包含 phase=queued、sequence、queuePosition（登记顺位，从 1 起且含执行中，不代表启动顺序）、waitReason、runningCount、concurrencyLimit；done 仍由退出确认决定。队列满返回 BUSY，等待项取消直接结束且不创建 worker。旧 response/1–7 需更新配套 EXE，旧 HTTP 1–7 返回 410。service-* 五个动作同样经公共协议转发，字段及管理权限见[服务管理](service-management.md)。

queue 返回 `{maxConcurrent,minConcurrent,maxAllowedConcurrent,maxPending,availableProcessors,recommendedConcurrent,canConfigure,runningCount,waitingCount,slots,waiting}`；slots 为 `{slot,occupied,job}`，job 是带公共 state 的作业行或 null。scheduling-set 输入 `{maxConcurrent}`、成功返回 scheduling/1 配置。范围、授权、空闲条件和稳定编号由公共服务核验，详见[队列](queue.md)。
