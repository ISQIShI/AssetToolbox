# 资源处理核心

Node CommonJS 核心，实现资源处理流水线、任务和安全恢复。当前支持 PNG/JPEG/MP3 压缩及 PNG/JPEG 缩放；未接 Cordis。扩展开发以[三层契约](../docs/architecture/extensions.md)为唯一接口说明。

| 位置 | 职责 |
| --- | --- |
| `resource-types/` | 格式识别与资源种类 |
| `properties/` | 通用及类型专属只读属性组；声明、版本与读取函数 |
| `operations/` | 操作参数、支持种类、结果验收策略 |
| `providers/` | pngquant、jpg-c、lame、sharp 共享依赖；`adapters/<operation>.js` 存放按操作分开的执行和专属参数 |
| `framework/` | 注册、schema、共享过滤求值、无 shell 进程执行 |
| `framework/dependencies/` | 固定清单、下载/解包/摘要验证、独立安装进程与受管理运行时 |
| `engine.js`、`cli.js` | 扫描、流水线、统一安全提交及直接 CLI |
| `application/` | [统一公共作业 /8](../docs/architecture/application.md)、权限/生命周期上下文、启动权限、幂等/分页、结构化 CLI 及[本机 HTTP API](../docs/architecture/http.md)；[外部 Agent 接入](../docs/architecture/automation.md) |
| `batch.js`、`desktop-bridge.js` | 持久任务编排、JSON Lines、进度和取消 |
| `settings.js`、`tasks.js`、`restore.js` | 原子配置、日志/锁、哈希恢复 |
| `data/` | 运行时配置、任务和报告，不提交 |
| `tests/` | 生成素材和隔离副本的核心回归 |

源码仓库不包含第三方 EXE/DLL；获取方式见各提供方 `provenance.json` 及桌面界面。提供方可用性同时检查可执行文件、伴随 DLL 和只读加载检查。

LAME/Sharp 支持受管理依赖副本，位于 `data/dependencies/`；检查文件完整性后优先使用，没有记录时使用原手动路径。自动安装范围与维护要求见[依赖管理](../docs/architecture/dependencies.md)。

本目录执行 `npm ci` 安装锁定的 Sharp（含平台原生依赖），再执行 `npm test`；`npm run process -- --help` 查看 CLI。本地便携目录需包含所用步骤的完整依赖（手动 node_modules/EXE 或受管理副本），不能只复制 JS；对外分发另须核对许可。核心配置、任务、报告均使用新 schema，不兼容旧项目格式。

音频实现位于 `providers/ffmpeg/adapters/`，三个操作复用 FFmpeg/FFprobe；支持 WAV/FLAC/MP3/Ogg。分析为只读 observe，增益/归一化必须另存或备份，不启用动态压缩。详见[音频专题](../docs/architecture/audio.md)。

来源及步骤统一使用 [filter/1](../docs/architecture/properties-and-filters.md)，由核心读取文件/图片属性。来源排除不进入任务和备份，步骤条件读取中间产物；续跑不重选来源，恢复不套用处理过滤。
