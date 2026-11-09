# AssetToolbox 资源工具箱

面向游戏等资源的 Windows 本地处理工具。已支持 PNG/JPG/MP3 压缩、PNG/JPG 图片缩放、可排序处理步骤、预览、取消、任务续跑/重试与选择性恢复。音频编辑、跨格式转换仍未实现。

开发者从 [AGENTS.md](AGENTS.md)、[文档索引](docs/README.md)、[项目状态](docs/project-status.md)开始。本版本使用全新契约，不读取或迁移旧版配置、任务、资源模块和 CLI。

## 便携运行

Windows x64，需要 WebView2 Runtime。双击根目录 `AssetToolbox.exe`。移动工具时一起携带 `runtime/` 和完整 `resource-core/`（包括安装好的 `node_modules/`、三个编码器及许可证）；完整便携包的使用者无需安装 Node。源码克隆后的构建步骤见[开发指南](docs/development.md)。

## 处理资源

1. 选择源文件夹和“另存为”或“覆盖原文件”；覆盖时建议启用备份。
2. 添加步骤，依次选择资源类型、处理操作、实现提供方，设置参数。用上下移调整顺序，用开关禁用步骤。
3. “扫描预览”只检查范围、输出冲突及依赖，不保存配置、不处理素材。
4. 点击“开始处理”。同一文件执行所有匹配类型的启用步骤，全部成功后才提交一次；不同类型的步骤自动跳过。

默认 PNG/JPG 压缩启用，MP3 压缩关闭。PNG 默认速度 3、质量 50–80，JPG 质量 5（0 跳过），MP3 ABR 24 kbps。压缩只有比该步骤输入更小才采用，否则保留该步骤输入继续执行。

“添加图片缩放”默认创建 PNG 缩放，可切换 JPEG。支持等比适应、居中裁剪填充、拉伸；最近邻适合像素画，Lanczos3 提供平滑插值。默认 512×512、仅缩小；取消“仅缩小”可放大，结果体积允许增加。PNG 保留透明度，JPEG 质量可调；按 EXIF 方向处理并移除附加元数据。首版限静态单页 PNG/JPEG，输入和目标均最多 4000 万像素，单边 1–16384。半透明颜色可能产生一个色阶的舍入。

例如把“PNG 图片缩放”移到“PNG 压缩”之前，即可先调整尺寸再压缩。后续步骤失败不会提交中间图片。没有适用步骤的已知文件，覆盖时不改动，另存时原样复制；未知格式不进入任务。

“开始处理”或“保存配置”保存路径、步骤及参数到 `resource-core/data/settings.json`；“恢复默认参数”保留步骤顺序、选择、开关及路径，仅重置参数。

## 文件保护与任务恢复

- 递归扫描忽略目录链接；输出/备份不可等于源目录或位于其上级。源目录内的输出/备份子树自动排除。
- 另存保持源文件与相对目录，已有同名输出不覆盖；处理失败时复制原文件并标为失败。只允许任务重试替换其拥有且哈希未变的失败副本。
- 覆盖前校验源文件未变化，写入成功才记为完成；备份保留原始字节。体积变化为负值表示变大。
- 取消及关闭窗口在文件边界生效，当前文件的全部步骤先完成；不会强杀正在执行的工具。
- “任务历史”可继续待处理文件或仅重试失败项。任务固定文件清单、参数、步骤和实现版本，不采用当前表单；版本不一致会拒绝续跑。要改变步骤需新建任务。
- 恢复前检查备份/目标哈希，只恢复明确勾选项；用户后来编辑的文件列为冲突。开始恢复后禁止原任务继续处理，恢复本身可继续/重试。
- 没有任务记录的独立备份可以检查后导出到指定目录；目标已有不同内容时不会覆盖。

配置、持久任务和报告分别位于核心 `data/settings.json`、`data/tasks/`、`data/reports/`；报告有 JSON 与 UTF-8 CSV。预览不创建任务或报告。不要删除仍需续跑或恢复的任务记录。

## 命令行

将步骤数组保存为 `pipeline.json`，格式见[扩展契约示例](docs/architecture/extensions.md#步骤及参数)，在工具根目录执行：

```powershell
.\runtime\node.exe resource-core/cli.js "D:\Assets" --pipeline pipeline.json --preview
.\runtime\node.exe resource-core/cli.js "D:\Assets" --pipeline pipeline.json --output "D:\Results"
```

直接 CLI 不创建持久任务。需要续跑时，将 `{ "mode": "process", "folder": "D:\\Assets", "pipeline": [...] }` 写入实际 JSON 请求文件（`[...]` 替换为步骤数组），执行 `node resource-core/batch.js request.json`；状态文件写到请求文件所在目录。

```powershell
.\runtime\node.exe resource-core/batch.js --resume "D:\Task\task.json"
.\runtime\node.exe resource-core/batch.js --retry "D:\Task\task.json"
.\runtime\node.exe resource-core/batch.js --restore-preview "D:\Task\task.json"
.\runtime\node.exe resource-core/batch.js --restore "D:\Task\task.json" --selection selection.json
```

勾选清单为预览返回的 `{path, backupHash, targetHash}` 数组；空数组表示不恢复，不可当成省略。CLI 省略 selection 会采用该命令的默认恢复范围，桌面始终显式传入。退出码 0 表示成功，1 表示失败，2 表示取消（失败优先）。
