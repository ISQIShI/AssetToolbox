# 配置 MCP

[返回用户文档](README.md) · MCP 让外部 Agent 调用本项目的处理功能，无需模型密钥。先安装 [Node 与核心/MCP 依赖](development.md#只部署-agent-或脚本入口)。桌面不需要保持打开，除非 HTTP 服务由桌面启动。

## 选择连接方式

| 方式 | 适用场景 | 启动者与认证 |
| --- | --- | --- |
| stdio（默认） | Agent 能启动本地进程，配置最少 | Agent 宿主按会话启动；使用 policy 文件，无 HTTP 令牌 |
| Streamable HTTP | 多个本机客户端连接同一个监听器 | 先显式启动服务；每个请求都带 Bearer 令牌 |

两种方式提供相同工具。不能将桌面 JSON Lines 桥接、普通 HTTP API 或旧 SSE 地址当作 MCP 端点。

## 1. 配置允许访问的目录

在项目根目录新建 `resource-core/data/`（已有则保留），将 [automation-policy.example.json](../examples/automation-policy.example.json)复制为 `resource-core/data/automation-policy.json`，编辑为实际绝对路径：

```json
{
    "schema": "asset-toolbox.automation-policy/2",
    "sourceRoots": ["D:/Game/Assets"],
    "outputRoots": ["D:/Game/Processed"],
    "backupRoots": ["D:/Game/Backups"],
    "allowOverwrite": false,
    "allowRestore": false,
    "allowDependencyInstall": false,
    "allowServiceManagement": false
}
```

素材、输出与备份使用独立目录，不把应用自身或 `data/` 放进素材范围。初次使用保持四个开关为 false，转换另存到 outputRoots 内。需要恢复、自动安装或服务管理时再显式授权；允许覆盖仍必须提供备份目录。policy 是应用路径校验，不是操作系统沙箱。

policy 在进程启动时读取，编辑后重启对应 MCP 进程。桌面也可在“工具 → Agent 接入与服务管理”设置目录权限并保存，再生成连接配置；它使用 `data/services/policy.json`，与上述手动文件是两种可选配置方式，不会自动同步。

## 2. 配置 stdio

在 Agent 宿主的 MCP 配置中添加以下条目，替换全部绝对路径。示例适用于接受 `mcpServers` JSON 的客户端；其他宿主按其设置界面填写相同 command/args：

```json
{
    "mcpServers": {
        "asset-toolbox": {
            "command": "C:/Program Files/nodejs/node.exe",
            "args": [
                "D:/Tools/AssetToolbox/agent-mcp/server.mjs",
                "--policy",
                "D:/Tools/AssetToolbox/resource-core/data/automation-policy.json"
            ]
        }
    }
}
```

`command` 必须是实际 Node 可执行文件；可在 PowerShell 用 `node -p "process.execPath"` 查询。已构建桌面的安装也可使用相邻 `runtime/node.exe`。不要把整个命令行塞进 command，不要添加 shell 包装。

保存后在宿主中重新连接；无需先双击或手动运行 `server.mjs`。进程在终端里等待输入是正常现象，它不是交互式 CLI。

## 3. 或者配置 Streamable HTTP

最方便的方式是打开桌面“工具 → Agent 接入与服务管理”：保存目录权限、端口和 MCP HTTP 开关，启动服务，再生成 HTTP 连接说明。服务状态会显示实际端点和本地令牌文件位置，不回显令牌正文。关闭启动它的桌面会安全停止服务。

没有桌面时，在项目根目录执行：

```powershell
# 文件必须不存在；只创建一次，已有令牌不要覆盖
node resource-core/application/token.js resource-core/data/http-token.txt
node agent-mcp/server.mjs --transport http --policy resource-core/data/automation-policy.json --token-file resource-core/data/http-token.txt --port 8787
```

保持这个终端运行。该命令同时提供普通 HTTP API 和 MCP；不要再在同一端口启动第二个 HTTP 服务。

在支持 Streamable HTTP 和自定义请求头的 Agent 中设置：

```json
{
    "mcpServers": {
        "asset-toolbox-http": {
            "url": "http://127.0.0.1:8787/mcp",
            "headers": { "Authorization": "Bearer <本地令牌文件的内容>" }
        }
    }
}
```

占位符不会自动读取文件；使用宿主支持的秘密配置方式，填入对应 tokenFile 的内容，不将其提交到 Git、截图或反馈中。实际字段名依宿主而异。不支持 OAuth 登录、远程连接或 `/sse`；会发送 Origin 的浏览器客户端不适用此本机服务。

## 4. 验证连接并执行任务

先让 Agent 调用 `asset_capabilities`，应返回资源类型、操作、提供方、目录权限和参数 schema。缺少处理工具时按 [安装指南](dependencies.md)准备；不要由 Agent 猜测工具版本或省略路径权限。

可给 Agent 以下任务说明（先替换为已授权的素材副本目录）：

> 先查询 AssetToolbox 的能力，将 D:/Game/Assets 内的 PNG 等比缩小到 256×256，另存到 D:/Game/Processed。先校验请求并扫描预览，报告问题；确认范围后处理，等待最终状态并汇报失败项。保留源文件，不覆盖已有输出。

典型调用顺序：

1. `asset_capabilities` 发现当前支持的 schema，`asset_validate` 校验请求。
2. `asset_submit` 提交 `mode: "preview"`；使用独立幂等键，查询 `asset_status` 直至 done，检查预览问题。
3. 将请求改为 `mode: "process"`，使用新的幂等键提交；参数示例见 [agent-resize.example.json](../examples/agent-resize.example.json)。
4. 按 jobId 查询 `asset_status`，确认 `done` 和 `exitCode`，再用 `asset_results` 获取分页明细。提交成功不等于处理成功。

相同键/请求重试返回同一作业，响应丢失不要换新键盲目重做。取消用 `asset_cancel`；需要续跑或失败重试时使用返回的 taskId。恢复必须先预览，再显式选择含哈希的条目，不能空选“恢复全部”。

stdio 宿主断连会请求取消其作业；HTTP 客户端断连不会取消作业，停止持有服务的入口才会请求取消。取消在文件边界生效，不回滚已完成文件。所有入口共用同一安装的队列，可在桌面“作业”观察结果。

权限或连接错误见[常见问题](troubleshooting.md)。完整动作和错误码见[自动化契约](../docs/architecture/automation.md)，仅用于进一步集成。
