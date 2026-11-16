# 快速开始

[返回用户文档](README.md)

## 选择运行方式

| 场景 | 需要准备 | 下一步 |
| --- | --- | --- |
| 桌面操作 | Windows x64、Node、Rust/MSVC、WebView2；从源码构建 | [开发与部署](development.md#构建和启动桌面) |
| Agent 使用 MCP | Windows x64、Node 24+、核心和 MCP npm 依赖 | [MCP 配置](mcp.md)；无需构建桌面 |
| CLI 或仅 HTTP API | Windows x64、Node、核心 npm 依赖 | [命令行](cli.md)、[HTTP API](http-api.md)；无需 Rust/MCP SDK |

首版的 Release 只有 Source code ZIP/tar.gz，解压后不会有 `AssetToolbox.exe` 或 `runtime/node.exe`。使用 Git 获取固定版本：

```powershell
git clone --branch v1.0.0 https://github.com/ISQIShI/AssetToolbox.git
cd AssetToolbox
```

安装环境并构建的完整命令见[开发与部署](development.md)，不要将浏览器演示模式误认为可以处理本地文件。

## 第一次处理图片

完成桌面构建后，从项目根目录运行 `AssetToolbox.exe`：

1. 打开“工具”，确认 Sharp 可用；缺少时使用“获取并安装”。默认压缩步骤还依赖 pngquant/JPG-C，暂不安装时先停用这些步骤。
2. 打开“处理 → 来源”，选一份 PNG 图片副本所在的文件夹。
3. 选择“另存到新文件夹”，使用空的输出目录。
4. “添加步骤 → 图片 → PNG → 图片缩放”，选择 Sharp，设置宽高，例如 256×256，保留等比适应和仅缩小。
5. 点击“扫描预览”，确认文件范围、依赖与冲突提示；再“开始处理”。
6. 在右侧概览栏（其他页面为底部作业栏）或“作业”页等待最终结果，查看输出图片；需要重做时使用新的输出目录，已有同名输出不会被覆盖。

JPEG 需要添加对应 JPEG 步骤。来源过滤排除的文件不复制；已识别但没有适用步骤的文件在另存模式下会原样复制。未知格式不进入任务。

## 接下来

- [使用指南](usage.md)：组合多个步骤、筛选尺寸、调整音量、备份与恢复。
- [MCP 配置](mcp.md)：让 Agent 先发现能力、预览，再提交处理。
- [常见问题](troubleshooting.md)：处理工具不可用、写入冲突或权限拒绝。
