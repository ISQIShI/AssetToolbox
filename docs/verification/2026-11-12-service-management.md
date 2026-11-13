# 2026-11-12：服务管理与入口覆盖验证

基线：`9da50ef` 加本轮提交。环境：Windows x64、开发 Node 26.13.0、便携 Node 24.19.0、现有 Rust/MSVC/WebView2。范围与边界见[服务管理](../architecture/service-management.md)。原始日志在忽略目录 `.local/maintenance/services-*.log`。

## 实际结果

| 目录 | 命令 | 结果 |
| --- | --- | --- |
| resource-core | `npm test` | 最后两轮均 163 通过、0 失败/跳过，35.3 / 37.8 秒；后一轮与原生构建同时运行 |
| desktop | `npm test` | 49 通过；新增公共服务面板行为测试 |
| desktop | `npm run typecheck` | 通过；最终构建再次执行 |
| agent-mcp | `npm test` | 最终 7 通过，10.6 秒 |
| desktop | `npm run build` | 最终通过；Rust release 1 分 40 秒，含 Vite 和便携依赖检查 |
| desktop | `npm run test:e2e` | 最终 EXE 2 通过，51.9 秒 |
| desktop | `npm run test:e2e:network` | 最终 EXE 1 通过，约 2 分钟 |
| 根目录 | `node scripts/check-docs.cjs` | 52 篇文档，0 失效链接 |
| 根目录 | `node scripts/check-release.mjs --source` | ready=true，未包含令牌、依赖或二进制 |

## 新增覆盖与发现

- 核心五动作：授权等权、拒绝 Agent 扩权、policy/1 拒绝、未知格式/硬链接拒绝、权限变化轮换令牌、响应不含令牌；HTTP-only 无 MCP 包仍可运行，缺 MCP 包明确失败。
- 生命周期：两个入口竞争启动仅一个监听器、重复启动不接管、CLI 输出启动回执后前台持有、另一 CLI 安全停止、启动期间退出不留端口；停止服务只取消自己的作业，其他本地作业完成。
- MCP 官方客户端：stdio 启动受管理 MCP HTTP，其他 HTTP/MCP 查询复用，受管理 HTTP MCP 自身请求停止；stdio 断连关闭其监听器；工具清单与公共 schema 全覆盖。
- 原生：工具页配置、实际 HTTP/MCP 请求、stdio/HTTP 连接说明、运行中禁止修改、离开页面不停止、窗口退出释放端口、重启保留配置且不自动启动。保留音频、恢复、队列、存储与外部作业回归。
- 截图初验发现全局 input 高度把多行目录与连接 JSON 压成单行，修正专属 textarea 高度后重建并复验。

## 间歇性失败与未覆盖范围

前两轮全量各发生一次不同位置的作业失败：既有 desktop 重试用例缺少 summary，以及新 services 用例的另一入口作业 exitCode=1。当时断言未输出完整状态，无法确认根因。补充最终状态诊断后，定向 7 项和后续两轮全量通过；没有删除安全断言、增加自动重跑或把该问题标记为已修复。后续若再现，应保留完整状态和 worker 错误后定位。

本轮未执行远端 CI、性能压测或后台守护服务验收；后者未实现。只处理生成素材与隔离副本，不改真实用户素材或手动依赖。源码分发检查不代表第三方二进制可分发。

最终 `AssetToolbox.exe`：9,075,712 字节，SHA-256 `8ded904e9743ef57ec07d1615b9abcc6b0752dc38d35f3858fffc943075956a2`。原生截图在忽略目录 `desktop/test-results/native/`，检查 services-1220-light 与 services-840-dark；目录和连接 JSON 可滚动复制，窄窗口无横向溢出。
