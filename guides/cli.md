# 命令行使用

[返回用户文档](README.md) · 先按[开发与部署](development.md)安装核心依赖。没有便携运行时时，以下命令中的 `.\runtime\node.exe` 可替换为已安装的 `node`。所有命令从项目根目录执行。

资源按图片、音频等类别分组，JPEG/PNG 等格式保留独立步骤。来源和每个步骤都可以设置属性条件。例如来源选择“资源格式等于 JPEG”且“图片宽度大于 1024 px”；也可选“资源类别等于图片”涵盖所有已识别图片格式。排除文件不复制、不处理、不备份。步骤过滤读取前一步的实际产物，未匹配只跳过该步骤。分辨率可分别约束宽/高或总像素数；规则支持“且/或”，详见[属性与过滤器](../docs/architecture/properties-and-filters.md)。恢复不继承处理过滤条件。

例如，要筛出短于 1 秒的 WAV、FLAC 音效，可将以下内容保存为过滤文件，再通过 `--source-filter <文件>` 传入。公共 API、MCP 和 HTTP 使用相同的 `sourceFilter` 对象。

```json
{ "schema": "asset-toolbox.filter/1", "any": [{ "all": [
    { "property": "audio-duration", "operator": "lt", "value": 1 }
] }] }
```

## 快捷处理

将下面的步骤数组保存为 `pipeline.json`，需要核心 Sharp 依赖；默认参数之外的选项见[扩展契约](../docs/architecture/extensions.md#步骤及参数)：

```json
[
    {
        "id": "resize-png",
        "resourceType": "png",
        "operation": "image-resize",
        "provider": "sharp",
        "enabled": true,
        "parameters": { "width": 256, "height": 256, "fit": "inside" },
        "providerOptions": {}
    }
]
```

在工具根目录执行，替换素材副本和输出路径：

```powershell
.\runtime\node.exe resource-core/cli.js "D:\Assets" --pipeline pipeline.json --preview
.\runtime\node.exe resource-core/cli.js "D:\Assets" --pipeline pipeline.json --output "D:\Results"
.\runtime\node.exe resource-core/cli.js "D:\Assets" --pipeline pipeline.json --source-filter examples/source-filter.example.json --preview
```

## 结构化 API

上述快捷命令与桌面、CLI API、MCP 和 HTTP 使用同一应用 /8 服务，返回结构化响应并创建持久 jobId；处理还生成 taskId，可续跑和恢复。API 的本机人工调用可显式使用 --local，外部 Agent 使用固定 --policy；权限配置见 [MCP 指南](mcp.md#1-配置允许访问的目录)。

```powershell
.\runtime\node.exe resource-core/cli.js api submit --local --input request.json
.\runtime\node.exe resource-core/cli.js api jobs --local
.\runtime\node.exe resource-core/cli.js api status --local --input status.json
```

续跑 request.json 示例：`{"request":{"mode":"resume","taskId":"<任务 ID>"},"idempotencyKey":"resume-001"}`；status.json 为 `{"jobId":"<作业 ID>"}`。恢复先提交 restore-preview，再从 results 的 restore 分页选择 `{path,backupHash,targetHash}`，执行时显式传非空 selection；省略或空数组均拒绝。batch.js 仅为内部 worker，旧批处理 CLI 不再支持。退出码 0 完成、1 失败、2 取消（失败优先）。

桌面和 Agent 共用[资源感知队列](../docs/architecture/queue.md)：同安装按配置的 1–8 个槽位并行（默认 2），冲突项按登记顺序等待，最多 100 个未结束项。作业中心显示等待原因及槽位用量；登记顺位不是预计启动顺序。

应用/响应 /8、HTTP /api/v8，旧 /api/v1–7 明确拒绝；持久 job 升级 /6，不读取或迁移旧 /1–5 作业。升级前关闭旧入口，桌面、核心和 MCP 必须成套更新。详细契约和最终架构见[统一应用接口](../docs/architecture/application.md)。

## 管理本机服务

复制并修改 [service-config.example.json](../examples/service-config.example.json)到本地 `resource-core/data/service-config.json`，然后执行：

```powershell
node resource-core/cli.js service configure --local --input resource-core/data/service-config.json
node resource-core/cli.js service start --local
# start 前台持有服务；在另一终端查询或停止：
node resource-core/cli.js service status --local
node resource-core/cli.js service stop --local
```

不要退出持有服务的终端并期待它继续后台运行。`stop` 是安全停止请求，继续查询状态直到 stopped；已处理的文件不会自动回滚。普通 API submit 也会等待作业结束，Ctrl+C 请求文件边界取消。
