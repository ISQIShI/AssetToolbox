# MCP HTTP 取消与 CLI 恢复预览并行验收

2026-11-18，Windows x64。基线为 `93ac2d5`，开发 Node 26.13.0。原始故障见[桌面作业跟踪验收](2026-11-18-desktop-job-tracking.md#首轮检查的间歇性失败)。测试使用临时便携副本、生成素材和系统分配的回环端口。

## 旧版对照

从基线提交导出源码，同时运行原 MCP HTTP 组合用例和 CLI 恢复预览用例。三个并行组各执行八轮，MCP 有一轮返回 `read ECONNRESET`，CLI 24 轮通过。另让八组旧版 CLI 各执行 15 轮，120 次均成功。日志位于忽略目录 `.local/maintenance/parallel-before-*.log` 和 `parallel-cli-baseline-*.log`。

## HTTP 拒绝响应与作业取消

旧组合用例在提交作业前会用 fetch 发送 1 MiB 加 1 字节的正文。旧版 12 次定向请求中，服务每次都在请求尚未收完时结束响应并关闭连接，其中一次客户端得到 `read ECONNRESET`。新版 12 次均能读取完整的 413，正常上传结束后服务才关闭连接。

新增核心回归先只发一个字节，等收到完整的拒绝响应再发剩余正文，核对服务端的响应结束次序。旧版在请求未收完时触发 `finish`，新版通过该断言。另测停发客户端和持续上传客户端的收尾上限。认证、来源、声明长度及分块超限分别记录结果。取消用例使用真实 worker，在第二个文件内等待 HTTP 取消回执，核对退出码 2、两份已完成输出、同一任务续跑的六个文件及全部源文件。

## CLI 恢复预览与跨入口观察

在旧版隔离副本中，CLI 先读取进行中的进度，worker 发布成功终态。用独立 Windows 进程以 `FileShare.None` 临时打开该文件，等 worker 正常退出。此时 CLI 最终读取遇到真实 `EBUSY`，用旧进度生成了 `INTERRUPTED`。旧版 CLI 退出码为 1，同一作业的 `exit.json` 与落盘终态均为 0。修复后按同样顺序在首次读取失败后约 65 毫秒释放文件，CLI 返回成功预览和退出码 0。对照日志为 `.local/maintenance/terminal-file-share-{before,after}.json`。

另一个可复现的窗口发生在独立观察者已读到旧进度，worker 随后发布退出标记时。现先采样退出凭据，再取状态。三项 CLI/核心新回归在旧版全部失败、修复后全部通过。测试保留了持续拒绝读取、坏 JSON、缺失最终记录和真实失败的断言。首次历史 CLI 失败缺少 stdout，无法追溯当时的 I/O 错误或持锁进程。

## 并行验收

| 检查 | 本机结果 |
| --- | --- |
| 重复原场景 | 三组并行，每组八轮。每轮同时运行 MCP HTTP 拒绝与取消、CLI 正常选择性恢复及最终状态首次读取忙碌的回归。24/24 轮通过，每轮 8 项含子测试 |
| 开发 Node 全量 | 核心 `node scripts/test-core.cjs all` 包含源码与真实编码器，198/198 通过。MCP 在 `agent-mcp/` 执行 `npm test`，15/15 通过。两套全量与重复场景在同一时段运行 |
| 便携 Node | 24.19.0 以文件并行度 4 运行 HTTP、原子发布、恢复预览及 MCP HTTP 测试，44/44 通过。命令见[测试分层](../testing.md) |
| 桌面 | 组件 85/85，类型检查、Vite 与 Tauri release 构建通过。新 EXE 及便携依赖通过 3 项原生 WebView2、1 项联网安装与处理 E2E |
| 仓库 | 84 篇文档链接有效，版本一致性、5 项发布工具测试及源码分发检查通过 |

本地执行日志为 `.local/maintenance/parallel-fixed-*.log`，点验 Windows 文件占用的原始输出见同目录 `terminal-file-share-*.json`。新 EXE 大小为 9,129,472 字节，SHA-256 为 `0618802bea2155a6d7c6da6c080c3a1c659e7141665cbd845c87f80cdabcf3bc`。
