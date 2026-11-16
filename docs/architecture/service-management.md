# 本机服务管理与入口覆盖

状态：已实现。应用/响应 /8、HTTP /api/v8、自动化 policy /2；job/6 与资源处理契约不变。源码：`application/{services,transports,service,contract}.js`、`agent-mcp/{server,tools,transports}.mjs`、`ServicePanel.vue`。决策见 [ADR 0016](../decisions/0016-service-management.md)。

## 公共动作与入口

| 动作 | 输入 | 行为 |
| --- | --- | --- |
| service-status | `{}` | 配置、运行状态、实际端点、是否由当前会话持有、令牌文件位置；不返回令牌正文 |
| service-configure | `{port,mcp,policy}` | 停止状态下保存一个安装级服务配置，端口 0–65535、mcp 为布尔值、policy 为 /2 完整权限对象 |
| service-start | `{}` | 启动配置中的回环 HTTP API，可同时挂载 MCP Streamable HTTP；已有活动服务返回 reused=true，不转移所有权 |
| service-stop | `{}` | 请求安全停止，返回 requested=true；轮询状态直到 stopped，运行中的文件允许先结束 |
| service-client-config | `{transport:"stdio"或"http"}` | 生成 stdio 宿主启动配置，或运行中的 HTTP 端点、认证占位和令牌文件路径 |

桌面“工具 → Agent 接入与服务管理”提供全部动作。CLI 提供 `service status/configure/start/stop/client-config`，同时保留 `api service-*`；HTTP 使用 `POST /api/v8/service-*`；两种 MCP 使用 `asset_service-*`。MCP 从公共 schema 枚举动作，缺少工具说明直接失败，不能悄悄漏掉新能力。

stdio 需要与 Agent 宿主建立标准输入/输出管道，不能在桌面中启动一个没有宿主连接的 stdio 进程；桌面生成可供宿主采用的配置，宿主负责按会话启动。HTTP 与 MCP HTTP 共用同一监听器和 policy 应用服务，不监听局域网。

## 配置与权限

受信任桌面、显式 `--local` CLI 可首次配置目录根及授权开关。自动化 policy/2 新增 `allowServiceManagement`，缺省 false；具备该权限且 policy 与安装配置完全一致的 Agent 才能查询、启动、停止或调整端口/MCP 开关。Agent 调用 configure 必须保持原 policy，不能扩大目录、覆盖、恢复、安装或管理权限。现有素材访问授权不自动包含服务管理权。没有配置时先由本机操作者初始化。

配置固定写入 `data/services/config.json`（services/1），派生 `policy.json` 供 stdio 启动；`token.txt` 自动生成 256 位随机令牌。改变 policy 时轮换令牌，旧客户端不能继承新权限；端口/MCP 开关变化保留令牌。文件使用独占临时写入、fsync 和原子替换，拒绝链接/硬链接及未知格式；Windows 沿用目录 ACL。外部修改损坏记录不会静默重置。

令牌不出现在返回值、生成的连接 JSON 或日志。stdio 配置不需要令牌；HTTP 客户端须在本机读取 tokenFile，填入 `Authorization: Bearer ...`。通用 HTTP 配置是连接说明，不承诺所有 Agent 宿主使用同一种 JSON 格式。

服务配置保留，不自动开机启动。启动时重新检查 policy、令牌与 MCP 包；HTTP-only 不需要 SDK，缺少 `agent-mcp` 或其依赖时返回 DEPENDENCY_MISSING 并给出安装命令。端口占用明确失败，不自动换端口（显式配置 0 除外）。

## 生命周期、跨入口控制与故障

服务运行在启动入口的 Node 进程内，以独立 policy/server 上下文持有 HTTP 作业。关闭桌面、结束拥有服务的 CLI 或断开拥有服务的 stdio，会停止该监听器、取消它自己的全部等待/运行作业并等待退出；不会取消其他入口作业。离开工具页、关闭纯观察窗口、HTTP 客户端断连均不停止服务。

安装级 services 锁协调启动/配置/停止；runtime/1 保存 PID、随机实例 ID、状态和实际端点，stop 请求携带实例 ID，旧停止请求不能停止重启后的新实例。停止为请求确认，不能把 requested 当成已经退出。启动过程中退出会等启动收尾并关闭监听器。没有后台守护进程、PID 强杀或自动接管；进程异常退出后显示 interrupted，再次显式启动创建新实例。PID 重用或坏记录保守拒绝；拥有者退出仍会关闭自己内存中的监听器。

手动入口 `application/http-server.js` 与 `agent-mcp/server.mjs --transport http` 继续支持指定外部 policy/token 文件；它们复用核心传输启动器，是独立的前台监听器，不登记到上述单个受管理配置。公共 service-* 管理的是安装配置启动的监听器，不会误停这些独立监听器。建议日常使用桌面或 CLI service；旧入口适用于由宿主直接编排传输的场景。

## CLI 示例

在仓库根执行；先按[配置示例](../../examples/service-config.example.json)修改实际目录与许可：

```powershell
.\runtime\node.exe resource-core/cli.js service configure --local --input examples/service-config.example.json
.\runtime\node.exe resource-core/cli.js service start --local
# start 输出一次启动响应，然后前台持有服务；另一终端可执行：
.\runtime\node.exe resource-core/cli.js service status --local
.\runtime\node.exe resource-core/cli.js service stop --local
'{"transport":"stdio"}' | .\runtime\node.exe resource-core/cli.js service client-config --local --input -
```

## 后续公共能力的交付要求

统一契约变更必须同步核心实现、schema、桌面操作路径、CLI 命令/帮助、两种 MCP 工具、HTTP 路由及文档示例；入口可以按权限明确拒绝，但不能缺少访问路径或偷偷采用另一套业务实现。专属窗口、对话框、主题等能力仅留在对应入口。

验收检查“动作 → 桌面控件/流程 → CLI → MCP stdio/HTTP → HTTP”的覆盖矩阵，并包含真实跨入口请求、相同错误与生命周期验证；不能用 schema 相等代替行为验收。当前新增五项完整覆盖在 `services.test.js`、MCP `http.test.mjs`、组件 `services.test.ts` 及原生 `native.spec.ts`。

属性与过滤不增加独立动作：capabilities 发现属性目录，validate/submit 接收来源和步骤条件；桌面共享编辑器、CLI `--source-filter` 与 JSON 请求、两种 MCP 工具、HTTP /api/v8 均已接入。MCP http 测试逐入口比较规范化、拒绝、排除数量和 filtered 结果，详见[属性与过滤器](properties-and-filters.md)。
