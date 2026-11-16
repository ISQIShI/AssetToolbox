# AssetToolbox 资源工具箱

面向游戏素材的 Windows 本地资源处理工具。把图片、音频的处理步骤组合成流水线，通过桌面、CLI、MCP 或 HTTP API 执行；支持先预览、保留原文件、任务续跑与备份恢复。

## 能做什么

| 资源 | 功能 |
| --- | --- |
| 图片（JPEG、PNG） | 压缩、等比缩放、裁剪填充、拉伸；按格式、尺寸、文件大小过滤 |
| 音频（WAV、FLAC、MP3、Ogg） | 音频分析、固定增益、响度归一化；MP3 另支持压缩 |
| 批处理 | 顺序执行多个步骤、扫描预览、另存或备份覆盖、取消、续跑、失败重试与选择性恢复 |
| Agent 接入 | CLI、MCP stdio、MCP Streamable HTTP 与本机 HTTP API，共用作业中心和资源感知队列 |

默认保留原文件。音频超峰时限制增益或报错，不自动启用动态压缩。当前不支持跨格式转换；HTTP 只监听本机，不提供公网服务。

## 开始使用

首版为 **v1.0.0 源码发行版**，项目自有代码使用 [MIT](LICENSE)。在 [GitHub Releases](https://github.com/ISQIShI/AssetToolbox/releases) 获取源码；**目前没有可直接运行的 EXE 下载包**，需要自行构建。第三方处理工具按需另行安装，适用各自许可。

1. 阅读[快速开始](guides/getting-started.md)，选择桌面或 Agent 接入方式。
2. 按[开发与部署](guides/development.md)准备 Windows 环境、安装依赖并构建。
3. 先用素材副本执行预览和另存处理，再用于实际项目。

## 用户文档

重要的对外说明统一放在 [`guides/`](guides/README.md)，按任务查阅：

| 文档 | 解决什么问题 |
| --- | --- |
| [快速开始](guides/getting-started.md) | 下载什么、需要什么、第一次怎样运行 |
| [使用指南](guides/usage.md) | 添加步骤、过滤资源、图片/音频处理、任务和恢复 |
| [处理工具安装](guides/dependencies.md) | 哪些依赖可一键安装、手动安装位置与渠道 |
| [MCP 配置](guides/mcp.md) | stdio 与 Streamable HTTP 接入、目录授权、验证连接 |
| [命令行](guides/cli.md) / [HTTP API](guides/http-api.md) | 脚本调用、提交作业、查询结果和管理服务 |
| [开发与部署](guides/development.md) | 从源码构建桌面、只部署 Agent 服务、测试与更新 |
| [常见问题](guides/troubleshooting.md) | 缺依赖、权限拒绝、连接失败、处理或恢复失败 |

## 参与开发

贡献者和 AI 从 [AGENTS.md](AGENTS.md)、[开发文档索引](docs/README.md)和[项目状态](docs/project-status.md)开始；版本规则及自动发布流程见[发布指南](docs/releasing.md)。扩展采用“资源类型—处理操作—实现提供方”契约，详见[扩展文档](docs/architecture/extensions.md)。

问题反馈请附版本、复现步骤和脱敏错误信息，勿上传素材、令牌或运行时数据。第三方来源和许可见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)；完整便携包的分发条件尚未核验完毕。
