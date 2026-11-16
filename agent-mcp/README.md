# AssetToolbox MCP

独立的本地 MCP 入口；默认 stdio，另支持 Streamable HTTP。使用官方 SDK 直接调用 `resource-core/application` 的 /8 公共作业接口，不需要模型密钥。

`asset_capabilities` 返回代码属性目录；`asset_validate/asset_submit` 的 process/preview 请求支持 sourceFilter，步骤支持 filter，两种传输一致。来源排除不复制或备份，步骤过滤按当前中间产物求值，恢复仍须显式选择；格式见[属性与过滤器](../docs/architecture/properties-and-filters.md)。

先安装核心依赖，再在此目录执行：

```powershell
npm ci --ignore-scripts
npm test
```

stdio 仍由 MCP 宿主启动 `node server.mjs --policy <绝对权限配置路径>`，可显式添加 `--transport stdio`。目录授权、工具契约与 CLI 对照见[外部 Agent 接入](../docs/architecture/automation.md)，可复制[权限示例](../examples/automation-policy.example.json)。宿主使用绝对 Node 和脚本路径。

额外 HTTP 模式：`node server.mjs --transport http --policy <配置> --token-file <令牌文件> --port 8787`，同时提供普通 API 和 `/mcp`。仅监听 127.0.0.1，需 Bearer 令牌；生成令牌、API 示例及宿主配置见[HTTP 指南](../docs/architecture/http.md)。它不会替换 stdio，也不随桌面启动。

stdio 关闭连接会请求文件边界取消；HTTP 单次连接结束不取消作业，须调用 cancel 或正常停止服务。工具输入 schema 直接来自核心 contract.js，与桌面、CLI 和 HTTP 共用；大型作业按 jobId 轮询，结果分页读取。依赖只在明确授权的 dependency-install 作业中从核验清单获取。

SDK server/client 固定 2.4.0，Node HTTP 适配器固定 2.1.2（包元数据 Apache-2.0，包内另有原贡献 MIT 的过渡说明）；Zod 固定 4.6.7（MIT）。锁文件记录完整来源、传递依赖和摘要，自有适配源码为 MIT。见[许可记录](../THIRD_PARTY_NOTICES.md)。不要提交 node_modules、令牌或本地权限配置。

当前公共契约声明 17 个动作，含 queue/scheduling-set 与 storage-preview/storage-clean；MCP 使用 policy 上下文，全局维护与调度配置动作明确返回 PERMISSION_DENIED。已由本机操作者清理的作业仍保留身份与摘要，结果查询返回 RESULTS_EXPIRED，不能自动使用新幂等键重做。见[存储维护](../docs/architecture/storage.md)。

新增五个 `asset_service-*` 工具管理已配置的本机监听器；需要 policy/2 的 allowServiceManagement 且与服务配置等权。可通过桌面生成 stdio 配置，由宿主启动会话；拥有服务的 stdio 断连会安全关闭该监听器。HTTP 连接说明不返回令牌正文。旧 policy/1 拒绝，详见[服务管理与入口覆盖](../docs/architecture/service-management.md)。

当前 API /8、HTTP /api/v8。submit 可返回等待中的作业；查询 queued/queuePosition、waitReason 后继续轮询至 done，登记顺位不代表启动顺序。默认 2 项、可配置 1–8 项无资源冲突的作业并行，100 个未结束项；capabilities.scheduling 可发现预算。stdio 退出取消自己所有等待和运行项，HTTP 客户端断开不取消，停止服务才取消。完整语义见[队列](../docs/architecture/queue.md)。
