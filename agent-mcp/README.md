# AssetToolbox MCP

独立的本地 MCP 入口；默认 stdio，另支持 Streamable HTTP。使用官方 SDK 直接调用 `resource-core/application` 的 /2 公共作业接口，不需要模型密钥。先安装核心依赖，再在此目录执行：

```powershell
npm ci --ignore-scripts
npm test
```

stdio 仍由 MCP 宿主启动 `node server.mjs --policy <绝对权限配置路径>`，可显式添加 `--transport stdio`。目录授权、工具契约与 CLI 对照见[外部 Agent 接入](../docs/architecture/automation.md)，可复制[权限示例](../examples/automation-policy.example.json)。宿主使用绝对 Node 和脚本路径。

额外 HTTP 模式：`node server.mjs --transport http --policy <配置> --token-file <令牌文件> --port 8787`，同时提供普通 API 和 `/mcp`。仅监听 127.0.0.1，需 Bearer 令牌；生成令牌、API 示例及宿主配置见[HTTP 指南](../docs/architecture/http.md)。它不会替换 stdio，也不随桌面启动。

stdio 关闭连接会请求文件边界取消；HTTP 单次连接结束不取消作业，须调用 cancel 或正常停止服务。工具输入 schema 直接来自核心 contract.js，与桌面、CLI 和 HTTP 共用；大型作业按 jobId 轮询，结果分页读取。依赖只在明确授权的 dependency-install 作业中从核验清单获取。

SDK server/client 固定 2.4.0，Node HTTP 适配器固定 2.1.2（包元数据 Apache-2.0，包内另有原贡献 MIT 的过渡说明）；Zod 固定 4.6.7（MIT）。锁文件记录完整来源、传递依赖和摘要，自有适配源码为 MIT。见[许可记录](../THIRD_PARTY_NOTICES.md)。不要提交 node_modules、令牌或本地权限配置。
