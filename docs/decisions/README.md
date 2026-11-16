# 架构决策记录

仅为影响系统边界、兼容性、依赖、数据格式或长期维护的决定创建记录。普通缺陷修复使用提交说明和相关专题文档即可。

| 编号 | 决策 | 状态 |
| --- | --- | --- |
| 0001 | [本地多进程与模块化核心](0001-local-process-architecture.md) | 部分被 0003 修订，保留进程边界 |
| 0002 | [资源工具箱职责与目录命名](0002-resource-toolbox-layout.md) | 部分被 0003 取代，仅保留历史背景 |
| 0003 | [资源类型、操作与实现提供方](0003-processing-contract.md) | 已采用；提供方接口与配置版本由 0007 修订 |
| 0004 | [以处理线为骨架重构前端](0004-frontend-redesign.md) | 已采用；视觉与窗口外壳部分被 0006 取代 |
| 0005 | [核验清单与不可变依赖安装](0005-managed-dependencies.md) | 已采用，仅自动获取审核过的固定依赖 |
| 0006 | [界面改为桌面软件外壳](0006-desktop-application-shell.md) | 已采用，修订 0004 的视觉与外壳，保留处理线结构 |
| 0007 | [提供方按操作组织适配器](0007-operation-adapters.md) | 已采用，提供方 API 2、独立适配与专属参数、公共参数保留 |

| 0008 | [只读操作与安全音频处理](0008-audio-observation.md) | 已采用，目录 API 3、操作 API 2、固定增益与原文件保护 |
| 0009 | [共享应用接口、CLI 与本地 MCP](0009-agent-interfaces.md) | 已采用，启动权限、幂等作业、分页结果及跨入口互斥 |
| 0010 | [统一应用门面与本机 HTTP](0010-local-http.md) | 已采用，保留 stdio、扩展 HTTP API 与 Streamable HTTP，补齐桌面应用上下文 |
| 0011 | [统一公共作业契约与上下文](0011-unified-application.md) | 已采用；应用/响应版本及结果保留由 0012 修订 |
| 0012 | [手动存储维护与测试分层](0012-storage-retention-and-test-layers.md) | 已采用，应用/响应 /3、job/2、30 天手动清理及分层 CI |

| 0013 | [持久 FIFO 与会话持有的串行调度](0013-persistent-fifo.md) | 已采用，版本与串行调度由 0014 修订 |
| 0014 | [资源感知队列与有限并行](0014-resource-aware-concurrency.md) | 已采用，固定预算及版本由 0015 修订 |
| 0015 | [可配置并行预算与稳定槽位](0015-configurable-concurrency.md) | 已采用，1–8 项、CPU 保守建议、空闲配置、应用 /6 与 job/5 |
| 0016 | [统一服务管理与公共能力入口覆盖](0016-service-management.md) | 已采用，应用 /7、policy/2、五个服务动作、跨入口访问与所有者生命周期 |
| 0017 | [代码属性目录与共享过滤器](0017-properties-and-filters.md) | 已采用；属性组、来源/步骤条件、固定清单、恢复隔离；修订目录/配置/任务/应用版本 |
| 0018 | [用无样式组件库提供浮层与选择行为](0018-headless-ui-primitives.md) | 已采用；Reka UI 仅作行为层，经 SelectBox/Tip 封装，外观仍由令牌决定 |
| 0019 | [处理页概览栏、不描边面板与窗口材质](0019-inspector-and-window-material.md) | 已采用；概览栏取代扫描结果站点，作业栏两种摆放，Windows 11 启用 Mica，新增只读 is_directory |

新增记录复制[模板](template.md)，递增编号并更新此索引。提议通过后再把结论写入当前架构文档；被取代记录保留历史，并链接新的决策。
