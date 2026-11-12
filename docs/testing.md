# 测试分层与 CI

源码入口：`scripts/test-core.cjs`、`.github/workflows/source.yml`、`desktop/playwright.config.ts`。所有文件处理测试使用生成素材和隔离副本，不能以真实用户目录作为夹具。

## 运行矩阵

| 目录 | 命令 | 前提与范围 |
| --- | --- | --- |
| `resource-core/` | `npm run test:source` | 安装锁文件依赖；验证契约、应用、HTTP、恢复、存储及依赖安全，不需要第三方 EXE |
| `resource-core/` | `npm run test:codecs` | Windows、本地 Sharp、pngquant、JPG-C、LAME、FFmpeg 齐全；真实图片/音频及编码器验收 |
| `resource-core/` | `npm test` | 上述两层全量执行；缺编码器明确失败，不静默跳过 |
| `agent-mcp/` | `npm test` | 官方 SDK 客户端验证 stdio、Streamable HTTP 和跨入口契约 |
| `desktop/` | `npm test`、`npm run typecheck` | 组件、状态管理、类型；不启动原生应用 |
| `desktop/` | `npm run build` | Windows Rust/MSVC/WebView2 与便携依赖；生成当前 EXE |
| `desktop/` | `npm run test:e2e` | 刚构建的 EXE、完整本地工具；原生 UI/音频/恢复/存储，隔离副本下载器禁止联网安装 |
| `desktop/` | `npm run test:e2e:network` | 同上且需要外网；真实 LAME/Sharp 下载、摘要验证、安装、更新及新安装的缩放处理 |
| 仓库根 | `node scripts/check-docs.cjs`、`node scripts/check-release.mjs --source` | 相对 Markdown 链接与源码发布范围 |

核心测试文件必须登记到 `test-core.cjs` 的 source/codecs 清单；未分类或漏文件直接失败。合成提供方验证调度与文件安全，真实编码器测试验证格式和效果，两者不能互相替代。原生测试不得设置 `ASSET_TOOLBOX_AUDIO_BROWSER`；浏览器备用验证单独记录。

## 自动验证

GitHub Actions 在 push、pull_request 和手动触发时使用 Windows runner；按 `.nvmrc` 和三个锁文件安装依赖，执行 source、MCP、组件、`build:web`、文档及源码检查。安装依赖需要网络，但不下载/上传第三方 EXE，不执行真实编码器或原生 E2E。不使用仓库写权限、凭据持久化或二进制 artifact。

官方 Actions 固定提交摘要：[checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) 对应 `3d3c42e5aac5ba805825da76410c181273ba90b1`；[setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) 对应 `949feb2413d6458794dcd2491c4babbbce0c15c1`。升级时重新核对发布及提交来源。

联网失败不能通过放宽 TLS、摘要或断言来解决；独立记录失败和重试结果。构建新 EXE 后必须重新运行原生验收。实际执行结果、未执行项及远端 CI 状态统一记录在[项目状态](project-status.md)。

队列测试位于 resource-core/tests/queue.test.js，属于 source 层。覆盖冲突 FIFO、多个持有者、等待取消/退出、死队首、启动不确定、适配器变化和容量。parallel.test.js 同属 source 层，覆盖真实并行/容量、目录别名、任务/备份/提供方资源、防饥饿、维护屏障、崩溃占用与启动失败。原生 E2E 另覆盖桌面与 CLI 同时处理、取消隔离、冲突排队原因、登记顺位及宿主等待桥接退出。
