# 资源处理核心

AssetToolbox 的 Node 本地核心，主要服务游戏资源处理。当前业务实现为图片/音频压缩、任务继续和安全恢复；后续操作按[职责与框架评估](../docs/plans/resource-processing-and-cordis.md)扩展。

| 位置 | 职责 |
| --- | --- |
| `framework/registry.js` | `discoverProcessors()`，返回 `processors` 与 `byExtension` |
| `framework/schema.js`、`framework/options.js` | 编译模块 schema、聚合参数与 CLI 校验 |
| `framework/process.js` | 无 shell 的工具进程调用 |
| `processors/<id>/` | 具体处理实现、参数定义、编码器及本模块配置 |
| `compress.js`、`restore.js` | 当前压缩操作与备份恢复；名称体现真实操作 |
| `batch.js`、`desktop-bridge.js` | 作业编排、报告、JSON Lines 桌面通信 |
| `settings.js`、`tasks.js` | 配置兼容、持久日志、任务锁 |
| `config/`、`tasks/`、`reports/` | 运行数据，禁止提交用户内容 |
| `tests/` | Node 内置测试；隔离目录与生成样本 |

在本目录执行 `npm test`；`npm run compress -- --help` 查看当前压缩 CLI。核心仍仅依赖 Node 标准库，尚未接入 Cordis。

新压缩格式见[处理器开发](processors/README.md)。旧布局迁移见 [ADR 0002](../docs/decisions/0002-resource-toolbox-layout.md#升级与回退)。`png`、`jpg`、`mp3` 是历史任务使用的稳定 ID，不随产品更名调整。
