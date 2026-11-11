# 本机 HTTP API 与 MCP Streamable HTTP

状态：已实现。仅支持本机 Agent；stdio MCP 保留且仍为默认启动模式。源码为 `resource-core/application/http.js`、`http-server.js`、`server-options.js`、`agent-mcp/server.mjs`、`tools.mjs`；决策见 [ADR 0010](../decisions/0010-local-http.md)。业务动作、目录 policy、幂等键和报告分页沿用[自动化契约](automation.md)。

## 统一应用服务边界

CLI API、桌面桥接、MCP（stdio/HTTP）和普通 HTTP API 均进入 `ApplicationService`。桌面桥接只负责 IPC 与消息映射，不再直接读取设置、注册器或任务存储。

应用服务有两个由启动代码选择的上下文：

- 桌面通过 `ApplicationService.forDesktop()` 建立受信任本地上下文，保留 bootstrap、设置保存、目录选择后的路径与临时作业 ID；动作实现集中在 `application/desktop-actions.js`。
- CLI API、HTTP、MCP 通过 policy 建立受限 Agent 上下文，统一使用八个动作、持久 jobId/taskId 和幂等键。网络参数不能选择桌面上下文，HTTP 服务拒绝挂载桌面实例；也不公开 save、bootstrap、任意 taskFile 或内部执行方法。

统一的是应用入口和执行设施，桌面与 Agent 的消息格式、权限和会话寿命仍各自明确。原人工位置参数 CLI 继续作为直接引擎入口，不属于 Agent API。

## 启动

先准备 `resource-core/data/automation-policy.json`，参照[权限示例](../../examples/automation-policy.example.json)填写素材、输出和备份目录。以下命令从仓库根执行。若 data 不存在，先创建；不要覆盖已有 policy。

```powershell
# 生成 256 位随机令牌，文件必须不存在；不会把令牌打印到日志
.\runtime\node.exe resource-core/application/token.js resource-core/data/http-token.txt

# 只启动 HTTP API，无需安装 MCP 包
.\runtime\node.exe resource-core/application/http-server.js --policy resource-core/data/automation-policy.json --token-file resource-core/data/http-token.txt --port 8787

# 或：同时提供 HTTP API 和 MCP Streamable HTTP；先在 agent-mcp 中 npm ci --ignore-scripts
.\runtime\node.exe agent-mcp/server.mjs --transport http --policy resource-core/data/automation-policy.json --token-file resource-core/data/http-token.txt --port 8787
```

上面两种 HTTP 命令选择其一；同端口已占用时明确失败，不自动改端口。端口默认 8787，`--port 0` 可由系统分配，启动输出返回实际地址。服务固定监听 `127.0.0.1`，不提供 `--host`、局域网监听或自动开机启动。启动信息只含端点地址，不包含凭据。

原 stdio 命令仍有效：

```powershell
.\runtime\node.exe agent-mcp/server.mjs --policy resource-core/data/automation-policy.json
# 等价于额外指定 --transport stdio；stdio 不需要 HTTP 令牌
```

stdio 由宿主按会话启动；HTTP 由使用者单独启动并保持运行。两种进程可同时存在，访问同一安装仍遵循现有执行互斥。

## HTTP API

所有请求都带 `Authorization: Bearer <令牌>`。API 是动作式 JSON 接口，路径为 `POST /api/v1/<action>`，正文与 CLI/MCP 对应动作的输入一致，响应沿用 `asset-toolbox.response/1`。

| 路径 | JSON 输入 | 成功响应 |
| --- | --- | --- |
| `/api/v1/capabilities` | `{}` | 200，目录、schema、提供方获取信息及当前 policy |
| `/api/v1/validate` | `{request}` | 200，规范化请求 |
| `/api/v1/submit` | `{request,idempotencyKey}` | 202，立即返回 jobId；需继续查询状态 |
| `/api/v1/status` | `{jobId}` | 200，进度、done、exitCode、taskId |
| `/api/v1/cancel` | `{jobId}` | 200，取消请求回执 |
| `/api/v1/jobs`、`/api/v1/tasks` | `{offset?,limit?}` | 200，分页摘要 |
| `/api/v1/results` | `{jobId,kind?,offset?,limit?}` | 200，分页文件、音频或恢复结果 |
| `GET /health` | 无正文 | 200，应用接口版本及是否挂载 MCP；仍需认证 |

示例：

```powershell
$assetHeaders = @{ Authorization = 'Bearer ' + (Get-Content -Raw resource-core/data/http-token.txt).Trim() }
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/v1/capabilities -Headers $assetHeaders -ContentType 'application/json' -Body '{}'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/v1/submit -Headers $assetHeaders -ContentType 'application/json' -InFile examples/agent-resize.example.json
```

先复制修改请求示例中的路径和幂等键。相同 policy 的 CLI、stdio、HTTP API 与 HTTP MCP 共用幂等记录；同一 HTTP 服务中的 API 和 MCP 使用同一个应用实例。响应丢失时使用同键重试，不以新键盲目重做。

错误状态：400 参数/版本/JSON 错误；401 缺失或错误令牌；403 Host、Origin 或目录权限拒绝；404 路径/作业不存在；405 方法不支持；409 BUSY、幂等冲突或结果尚未就绪；413 超过请求上限；415 媒体类型/压缩编码不支持；422 缺依赖或需手动安装；503 服务正在退出。作业级失败仍通过 status 的 exitCode/errorCode 与 results 表达；202 不代表处理成功。

## MCP Streamable HTTP

联合服务的 MCP 地址为 `http://127.0.0.1:8787/mcp`。在支持自定义请求头的宿主中配置 URL 和 `Authorization`，概念示例如下；各宿主字段名和秘密注入语法可能不同：

```json
{
  "mcpServers": {
    "asset-toolbox-http": {
      "url": "http://127.0.0.1:8787/mcp",
      "headers": {"Authorization": "Bearer <从本地令牌文件读取>"}
    }
  }
}
```

不要把实际令牌或带凭据的宿主配置提交到 Git。本实现使用预共享本地令牌，不提供 OAuth 登录、发现或自动令牌刷新；需要浏览器授权的宿主不属于本轮支持范围。

使用官方 SDK 的 [createMcpHandler](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/createMcpHandler.html) 和 Node 适配器，按请求创建新的 MCP 协议实例，共享应用服务。`tools.mjs` 是两种传输唯一的工具/schema 定义；保留传统协议的无状态处理及 2026-07-28 协商。HTTP 响应按 SDK 使用 JSON 或 SSE；不维护 MCP Session ID，GET/DELETE `/mcp` 返回 405，也不提供旧式独立 `/sse` 端点。

## 生命周期与本机保护

HTTP 请求结束、客户端关闭或临时网络中断都不取消已提交作业；作业由服务进程持有。需要取消时调用 cancel。Ctrl+C/正常服务退出停止接收新请求、请求文件边界取消、等待工作进程结束后关闭连接。Windows 强杀整个进程树仍按既有 INTERRUPTED 与任务日志恢复，不承诺自动回滚。

stdio 会话结束仍请求安全取消，与 HTTP 语义区分。HTTP 服务持有一个活动作业，支持多个客户端查询；它不是并行队列。所有持有同一令牌的客户端是同一授权主体，可查询/取消该 policy 范围内的作业，不提供多用户隔离。

Host 必须是当前端口的 127.0.0.1 或 localhost，不采信代理转发头。任何 Origin 均拒绝，不启用浏览器 CORS；无 Origin 的本机客户端仍须认证。拒绝重复安全头、URL 查询携带令牌及非 JSON/压缩请求；JSON 正文最多 1 MiB（含 chunked），头部最多 16 KiB，并限制请求超时和连接数。提前拒绝的连接关闭，防止未读正文被误作下次请求。令牌在启动时读取，轮换需停止服务、更换文件后重启；Windows 文件权限由所在目录 ACL 决定。

本机令牌与目录 policy 不替代 OS 沙箱。没有增加文件上传/下载、任意命令、远程网络监听、代理部署或公有服务；处理路径始终是服务器本机目录。

验证入口：核心 `http.test.js`（真实 socket、请求边界、状态码、生命周期、独立入口）与 `desktop.test.js`；MCP `http.test.mjs`（官方客户端、新旧协议、并发实例、共享幂等、显式取消、断连后继续）及原 stdio 测试。全量结果见[项目状态](../project-status.md)。
