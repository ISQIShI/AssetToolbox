# ADR 0011：统一公共作业契约与上下文

后续修订：[0012](0012-storage-retention-and-test-layers.md) 更新结果保留语义，[0013](0013-persistent-fifo.md) 更新应用/作业版本与调度方式；下文保留实施当时背景，统一实现与上下文原则继续有效。

[0017](0017-properties-and-filters.md) 在同一公共能力中加入属性目录与来源/步骤过滤，更新应用、作业及素材任务版本；各入口仍只适配。

状态：已采用。日期：2026-11-10。修订 [0009](0009-agent-interfaces.md) 和 [0010](0010-local-http.md) 的统一边界；保留 HTTP/stdio、目录授权及文件保护设计。

## 背景

首版只让外部入口共用应用服务。0010 把桌面转发到同一个类，但 desktop 分支仍直接 start/poll/cancel JobSession，使用临时 ID 和 taskFile，CLI 快捷命令也直接执行引擎。这仅统一入口位置，未达到原方案要求。验收曾把各入口功能正常当成架构统一，现予以更正。

## 决策

所有入口复用唯一的八个公共应用动作。桌面直接使用 submit/status/cancel/results 和 taskId；快捷 CLI 只转换请求，batch 移除用户命令。MCP schema 由核心 contract.js 生成。应用服务不按入口类型分派公共作业；桌面设置独立且不访问 JobSession。

启动代码注入不可从请求构造的上下文，统一处理权限、幂等作用域和 connection/server 生命周期。所有作业持久化到 data/jobs/v2；作业可见性按当前权限重新核验，可授权跨入口查看和取消。关闭观察者上下文不取消其他拥有者的作业。

应用/响应/job 升级 /2，HTTP 使用 /api/v2；旧 /1、临时桌面命令和 automation 存储明确拒绝或不读取，不自动迁移。素材任务、报告、配置和扩展版本保持不变。

## 代价与验收

桌面预览也会留下持久作业记录，需要将来另行设计清理；桌面必须配套新核心重建。共用业务不等于所有客户端拥有同等权限，HTTP 仍仅本机、令牌认证、受 policy 约束。

验收必须包含真实桌面 JSON Lines、CLI、stdio MCP、普通 HTTP 与 HTTP MCP 的交叉提交/查询/取消/结果比较，以及上下文生命周期、越权拒绝、原生 EXE 与 CLI 状态一致。原方案的完整实现以[统一应用接口](../architecture/application.md)和这些测试为准。

后续修订：[0013](0013-persistent-fifo.md) 增加持久 FIFO，升级应用/响应 /4、job/3；下文版本与立即启动描述保留为历史。
