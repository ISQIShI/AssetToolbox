# AssetToolbox MCP

独立的本地 stdio 入口；使用官方 MCP SDK，直接调用 `resource-core/application`。不监听端口，不需要模型密钥。先安装核心依赖，再在此目录执行：

```powershell
npm ci --ignore-scripts
npm test
```

由 MCP 宿主启动 `node server.mjs --policy <绝对权限配置路径>`。目录授权、完整配置、工具契约与 CLI 对照见[外部 Agent 接入](../docs/architecture/automation.md)，可复制[权限示例](../examples/automation-policy.example.json)。MCP 宿主使用绝对 Node 和脚本路径，避免依赖工作目录。

关闭连接会请求文件边界取消，后续用持久 taskId 续跑。大型作业按 jobId 轮询，结果分页读取。依赖只在明确授权的 dependency-install 作业中从现有核验清单获取。

SDK 固定 2.4.0（包元数据 Apache-2.0，包内另有原贡献 MIT 的过渡说明），Zod 固定 4.6.7（MIT），锁文件记录完整来源和摘要。自有适配源码为 MIT，第三方声明见[许可记录](../THIRD_PARTY_NOTICES.md)。不要提交 node_modules 或本地权限配置。
