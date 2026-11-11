# 外部 Agent、CLI 与 MCP

状态：已实现本地应用 API /1、结构化 CLI 和 stdio MCP。源码为 `resource-core/application/`、`resource-core/cli.js`、`agent-mcp/server.mjs`；决策见 [ADR 0009](../decisions/0009-agent-interfaces.md)。不需要模型密钥，也不启动 HTTP 服务。

## 接入与目录授权

先按[开发指南](../development.md)安装核心依赖。CLI 只依赖现有核心；MCP 另在 `agent-mcp/` 执行 `npm ci --ignore-scripts`。开发使用锁定 Node，便携 Node 24.19.0 也已验证。MCP 包不会加入桌面核心的 npm 依赖。

将[权限示例](../../examples/automation-policy.example.json)复制到忽略目录，如 `resource-core/data/automation-policy.json`，由使用者修改绝对目录。三个根数组分别限定素材读取、结果写入和备份写入；覆盖、恢复/导出、自动安装三个开关默认关闭。转换要求 `outputDir`，除非明确允许覆盖且指定 `backupDir`；纯音频分析可不传保存目录。缺失目录不自动创建，只有实际处理按需创建目标。

权限文件只在 CLI/MCP 启动时读取，工具参数不能扩权。真实路径校验阻止通过目录联接越界，作业执行及查询重新核对；素材范围不能包含核心代码或 `data/`。这是应用边界校验，不是 OS 沙箱；持有本机 shell 或代码写权限的 Agent 仍应由宿主控制。根配置改变后旧作业不再属于新范围，可用原配置查询；当前仍获授权的任务可按 taskId 续跑。

在 MCP 宿主中填写以下 stdio 配置，将示例安装位置替换为实际路径。无需预先手动启动服务：

```json
{
  "mcpServers": {
    "asset-toolbox": {
      "command": "D:/Tools/AssetToolbox/runtime/node.exe",
      "args": [
        "D:/Tools/AssetToolbox/agent-mcp/server.mjs",
        "--policy", "D:/Tools/AssetToolbox/resource-core/data/automation-policy.json"
      ]
    }
  }
}
```

采用官方 SDK 2.4.0 的 [serveStdio](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html)。官方客户端已验证传统 initialize 与 2026-07-28 协商；具体宿主的配置格式可能不同。只使用普通工具调用，不依赖 MCP Tasks、Roots、采样或实验性长任务协议。

## 统一动作

CLI 动作为下表 action，MCP 对应 `asset_<action>`。两者直接调用同一应用服务，MCP 不执行 shell 或解析 CLI 文本。

| action | 输入 | 返回及用途 |
| --- | --- | --- |
| capabilities | `{}` | 目录 API 3、每操作/适配器 JSON Schema、版本、依赖获取说明，以及当前 policy |
| validate | `{request}` | 规范化步骤与版本、校验路径权限；不扫描、不编码 |
| submit | `{request, idempotencyKey}` | 创建作业；MCP 立即返回 jobId，CLI 等待最终状态 |
| status / cancel | `{jobId}` | 进度/结果或协作取消请求 |
| jobs / tasks | `{offset?, limit?}` | 当前权限内的作业/持久任务；tasks 包含桌面创建的任务 |
| results | `{jobId, kind?, offset?, limit?}` | 完成后查询 files、audio 或 restore 明细，默认 files |

分页默认 50、最大 100；返回 `items/total/nextOffset`，末页 nextOffset 为 null。当前会先读入整个报告再截取，尚不适合超大单批报告。status 返回摘要和 taskId，不重复发送整个音频报告、恢复列表或文件内容。

`request.mode` 支持：

- `preview/process`：folder、pipeline，可选 outputDir 或 backupDir。
- `resume/retry/restore-preview`：taskId，不能传任意 taskFile。
- `restore/restore-retry`：taskId 加非空 selection。
- `restore-export-preview/restore-export`：backupDir、outputDir；实际导出还需非空 selection。
- `dependency-install`：只能传 providerId；安装当前应用核验清单版本，覆盖安装/更新/修复语义，手动提供方继续通过 capabilities 获取指引。

恢复先提交对应 preview，再通过 `results {kind:"restore"}` 选择条目，将其 `path/backupHash/targetHash` 原样放入 selection；执行前再次核对哈希。普通 preview 只扫描匹配范围、冲突和依赖，不进行图片转换或音频测量；测量必须执行 `audio-analyze`。参数 JSON Schema 来自当前注册器，跨字段约束仍以 validate 和工作进程为准。

## CLI 示例与返回语义

以下命令在仓库根目录执行。先复制并修改[缩放请求示例](../../examples/agent-resize.example.json)，不要直接操作真实素材试验：

```powershell
.\runtime\node.exe resource-core/cli.js api capabilities --policy resource-core/data/automation-policy.json
.\runtime\node.exe resource-core/cli.js api submit --policy resource-core/data/automation-policy.json --input examples/agent-resize.example.json
.\runtime\node.exe resource-core/cli.js api jobs --policy resource-core/data/automation-policy.json
```

`--input -` 读取 UTF-8 stdin JSON；省略 input 等价于 `{}`。stdout 只有一个 `asset-toolbox.response/1` JSON，启动回执与日志写 stderr。成功响应 `{schema,ok:true,result}`；拒绝响应 `{schema,ok:false,error:{code,message}}`。CLI submit 始终等待，便于脚本可靠取得退出码；另一个 CLI 进程可通过相同 policy 的 jobs/status/cancel 查询和取消。

原有位置参数 CLI 仍是受信任的人工本地入口，使用执行锁，但没有 Agent 启动权限契约。宿主为 Agent 配置命令时应使用 `api` 子命令；拥有任意 shell 权限并不等于被应用 policy 隔离。

业务拒绝使用 INVALID_REQUEST、UNSUPPORTED_VERSION、PATH_FORBIDDEN、PERMISSION_DENIED、NOT_FOUND、DEPENDENCY_MISSING、MANUAL_INSTALL_REQUIRED、BUSY、IDEMPOTENCY_CONFLICT、NOT_READY。MCP 同时提供 text、structuredContent 与 isError；SDK 在进入业务前拒绝不合法工具参数时使用其标准 MCP 错误。作业成功提交不表示处理成功，务必查询 `done/exitCode`：0 完成、1 失败、2 取消；逐文件失败及未提交音频测量见 results。预览 issues 也应检查，不能只看退出码。

## 作业、互斥与断连

幂等键为 1–128 个英文、数字或 `._:-`，作用域由规范化权限配置决定；同键同规范化请求返回同一个持久 jobId，同键不同请求明确冲突。键在启动前落盘，不自动回收；启动失败或中断也不会静默重执行。失败后先查 taskId 和报告：已有任务优先 resume/retry，确定需要新作业时才使用新键。不同键不保证业务去重。

jobId 对应一次预览/执行；taskId 对应可多次续跑、重试和恢复的素材任务。自动化作业存入 `data/automation/<scope>/<jobId>/`，包含 /1 job 记录、request/status/cancel、worker/exit 记录；桌面仍使用临时会话 ID。两者共用 `JobSession` 和批处理进程，自动化不会保存桌面 settings。

同一 Windows 用户、同一核心安装的 GUI、CLI 和 MCP 通过系统临时目录中的安装路径哈希锁串行执行作业，包括预览和依赖安装；冲突返回 BUSY。原有每任务锁继续保留。不同安装副本、不同用户或直接调用 engine 库不共享此锁，不能据此并发操作同一素材。失效 PID 锁可回收；无法确认的锁保守拒绝。

MCP stdin 结束、正常关闭和 CLI 中断会请求取消，当前文件完成后停止。父进程死亡时仍存活的工作进程会在文件边界检查并停止；Windows 强杀可能同时结束进程树，此时返回 INTERRUPTED 并从任务日志刷新进度，靠既有提交意图与哈希机制续跑，不能宣称正常取消或整批成功。没有跨宿主常驻队列。已完成结果、备份和断点保留，取消不回滚已完成文件。界面任务历史可以看到 Agent 素材任务，但未增加跨窗口的实时作业面板。

验证：核心 `application.test.js` 覆盖权限、联接、幂等、分页、真实 Sharp/FFmpeg、恢复/导出和跨入口锁；MCP `server.test.mjs` 使用官方客户端验证发现、执行、新旧协议、断连与重连。HTTP、远程授权、常驻服务、多作业并发、流式报告和自动清理仍未实现。
