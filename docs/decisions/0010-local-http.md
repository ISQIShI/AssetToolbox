# ADR 0010：统一应用门面与本机 HTTP 传输

状态：已采用。日期：2026-11-10。部分修订 [ADR 0009](0009-agent-interfaces.md) 的入口与生命周期，保留扩展契约、目录 policy、幂等和文件保护。

> 后续修订：[0011](0011-unified-application.md) 完整统一公共作业契约；本文的桌面临时作业/专用分支描述仅保留为历史决策。

## 背景

首版只有 CLI/MCP 共用 ApplicationService，桌面直接使用 JobSession，统一应用入口尚不完整。用户要求保留 stdio，并额外提供 HTTP API 和 MCP Streamable HTTP，明确本轮面向本机 Agent。

## 决策

DesktopBridge 改为 ApplicationService 的传输适配；本地桌面上下文承接设置、目录信息和临时作业。受限 Agent 上下文继续提供八个统一动作，不能从请求参数切换为桌面上下文。各上下文共用注册器、JobSession、工作进程和执行锁。

核心以 Node http 提供版本化动作 API，可独立运行而无需 MCP 包。联合入口在同端口挂载 `/api/v1/` 与 `/mcp`，引用同一个受限应用服务。MCP 保留默认 stdio；工具定义抽为唯一工厂，HTTP 按每个请求创建新的协议实例，通过官方 SDK 处理 JSON/SSE 和协议协商，应用作业不存放在 MCP 协议会话里。

固定回环监听、预共享随机令牌、严格 Host/Origin、正文/超时边界，启动 policy 不变。本轮不实现 OAuth、多用户、TLS/代理或局域网监听。SDK Node 适配器 2.1.2 与现有 server/client 2.4.0 匹配，独立锁文件记录传递依赖和许可。

HTTP 请求断开不取消已经提交的作业；调用 cancel 或正常停止服务才请求文件边界取消。stdio 会话关闭继续取消。所有入口共享幂等键与持久任务，服务进程退出不保证继续后台运行，强杀依靠任务日志恢复。

## 代价与后续边界

桌面和 Agent 使用同一应用门面，但保留不同权限/DTO，避免通过网络暴露桌面设置和任意 taskFile。全局串行暂不提升吞吐。预共享令牌适合单用户本机使用，并非远程认证方案；若将来需要远程访问，应另行设计身份、HTTPS、租户与任务归属，不能只放宽监听地址。

实际接口与验证见[HTTP 专题](../architecture/http.md)。
