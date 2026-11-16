# 使用本机 HTTP API

[返回用户文档](README.md) · 用于本机程序或 Agent 集成。HTTP API 与 MCP HTTP 共用业务接口，但请求格式不同：普通 API 调用 `/api/v8/<action>`，MCP 客户端连接 `/mcp`。

## 启动

先按[开发与部署](development.md)安装核心依赖，按 [MCP 目录授权](mcp.md#1-配置允许访问的目录)建立 `resource-core/data/automation-policy.json`。在项目根执行：

```powershell
# 一次性创建令牌；已存在时保留原文件
node resource-core/application/token.js resource-core/data/http-token.txt
node resource-core/application/http-server.js --policy resource-core/data/automation-policy.json --token-file resource-core/data/http-token.txt --port 8787
```

该入口只启用普通 HTTP API，无需 MCP SDK。要同时提供 MCP，改用 [MCP HTTP 启动命令](mcp.md#3-或者配置-streamable-http)，二者选择一个。桌面“工具 → Agent 接入与服务管理”也可配置和启动；由桌面生成的令牌文件位置以状态显示为准，不是上述手动文件。

服务只监听 `127.0.0.1`，必须保持启动进程运行。端口冲突时更换端口，或用 `--port 0` 并读取启动输出中的实际地址。当前不支持局域网、公网或浏览器跨域访问。

## 调用示例

在另一个 PowerShell 终端切换到项目根。令牌只放在请求头，不放 URL：

```powershell
$assetHeaders = @{ Authorization = 'Bearer ' + (Get-Content -Raw resource-core/data/http-token.txt).Trim() }
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/v8/capabilities -Headers $assetHeaders -ContentType 'application/json' -Body '{}'
```

将[缩放请求示例](../examples/agent-resize.example.json)复制到本地，按 policy 修改 folder、outputDir 和幂等键。先用 `mode: "preview"`，确认结果后以新键提交 `mode: "process"`：

```powershell
$assetJob = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/v8/submit -Headers $assetHeaders -ContentType 'application/json' -InFile resource-core/data/request.json
# 先检查 $assetJob.ok，再使用返回的 jobId
$assetStatusBody = @{ jobId = $assetJob.result.jobId } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/v8/status -Headers $assetHeaders -ContentType 'application/json' -Body $assetStatusBody
```

`submit` 返回 202 只表示登记成功，可能仍排队。重复查询 status，直到 `done: true`；exitCode 0 为完成、1 为失败、2 为取消，预览还须检查 issues。相同幂等键只用于重试同一请求；新任务使用新键。

## 常用动作

所有动作使用 POST、JSON 正文和同一认证头。返回 `{schema,ok,result}` 或 `{schema,ok:false,error}`。

| action | 正文 | 用途 |
| --- | --- | --- |
| capabilities | `{}` | 能力、schema、依赖状态及当前权限 |
| validate | `{request}` | 只校验请求，不扫描处理 |
| submit | `{request,idempotencyKey}` | 创建预览、处理、恢复等作业 |
| status / cancel | `{jobId}` | 查询进度或请求取消 |
| jobs / tasks | `{offset:0,limit:50}` | 当前权限内的作业或素材任务 |
| results | `{jobId,kind:"files",offset:0,limit:50}` | 明细；kind 还可为 audio、restore |
| queue | `{}` | 查询并行预算与排队状态 |

分页返回 nextOffset，直到 null。`results` 在作业结束后查询；存储维护已清理的明细返回 RESULTS_EXPIRED，不应因此重复处理素材。服务管理动作 `service-*` 需单独授权，不能借此扩大目录权限；命令与边界见[服务管理](../docs/architecture/service-management.md)。

## 停止与排错

客户端断开不会取消已提交作业，显式调用 cancel。Ctrl+C 或关闭启动服务的桌面会停止接收新请求并请求取消自己的作业，当前文件结束后退出；不要用强杀代替正常停止。

401 检查 tokenFile 与 Bearer 值；403 检查目录、Host 和 Origin；409 可能为结果尚未就绪、幂等冲突或队列满；422 为缺依赖等业务条件。JSON 正文最大 1 MiB，不支持压缩正文或 URL 令牌；任何 Origin 均拒绝，不应通过代理绕过校验。

详细状态码及所有动作见 [HTTP 契约](../docs/architecture/http.md)和[自动化契约](../docs/architecture/automation.md)。
