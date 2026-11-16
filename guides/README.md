# 用户文档

这里面向使用者、Agent 接入者和自行构建部署的人，说明如何完成具体任务。项目介绍见[根 README](../README.md)；内部架构、决策和逐轮验收留在 [`docs/`](../docs/README.md)。本文档与对应源码版本一起发布，下载旧版本时应阅读该标签下的文档。

| 你想做什么 | 从这里开始 |
| --- | --- |
| 了解安装要求并处理第一批资源 | [快速开始](getting-started.md) |
| 配置处理步骤、过滤条件、任务与恢复 | [使用指南](usage.md) |
| 获取缺少的编码器或处理工具 | [安装与更新处理工具](dependencies.md) |
| 让 AI Agent 调用工具 | [MCP 配置](mcp.md) |
| 编写本地脚本 | [命令行](cli.md) |
| 接入已有本机程序 | [HTTP API](http-api.md) |
| 编译 EXE 或部署纯 Agent 服务 | [开发与部署](development.md) |
| 排查无法启动、连接或处理的问题 | [常见问题](troubleshooting.md) |

v1.0.0 只提供源码，支持 Windows x64。图片缩放安装核心 npm 依赖后即可使用；其他功能按需获取提供方。MCP 不要求模型 API 密钥；它向已有 Agent 暴露本地工具，不包含 AI 模型或聊天客户端。

文档中的 `D:/Tools/AssetToolbox`、`D:/Game/Assets` 等均为示例，替换为自己的路径。首次尝试使用素材副本，输出到独立目录；不要将真实权限文件、服务令牌或报告提交到 Git。
