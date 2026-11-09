# 资源处理核心

Node CommonJS 核心，实现资源处理流水线、任务和安全恢复。当前支持 PNG/JPEG/MP3 压缩及 PNG/JPEG 缩放；未接 Cordis。扩展开发以[三层契约](../docs/architecture/extensions.md)为唯一接口说明。

| 位置 | 职责 |
| --- | --- |
| `resource-types/` | 格式识别与资源种类 |
| `operations/` | 操作参数、支持种类、结果验收策略 |
| `providers/` | pngquant、jpg-c、lame、sharp 实现与依赖 |
| `framework/` | 注册、schema、无 shell 进程执行 |
| `engine.js`、`cli.js` | 扫描、流水线、统一安全提交及直接 CLI |
| `batch.js`、`desktop-bridge.js` | 持久任务编排、JSON Lines、进度和取消 |
| `settings.js`、`tasks.js`、`restore.js` | 原子配置、日志/锁、哈希恢复 |
| `data/` | 运行时配置、任务和报告，不提交 |
| `tests/` | 生成素材和隔离副本的核心回归 |

本目录执行 `npm ci` 安装锁定的 Sharp（含平台原生依赖），再执行 `npm test`；`npm run process -- --help` 查看 CLI。发布 Windows x64 便携包必须包含完整生产 `node_modules/` 及三个 EXE，不能只复制 JS。核心配置、任务、报告均使用新 schema，不兼容旧项目格式。
