# 开发文档索引

本目录说明 AssetToolbox 资源工具箱的当前设计、开发约束与接手状态。面向使用者的操作步骤继续放在[根目录 README](../README.md)，避免同一规则在多处分别维护。

## 首次接手

按顺序阅读 [AGENTS.md](../AGENTS.md)、[项目状态](project-status.md)、[总体架构](architecture/overview.md)，再根据任务阅读对应专题。开始修改前，核对专题列出的源码与测试；源码和文档不一致时先确认实际行为，并在本次变更中修正文档。

| 文档 | 内容及适用任务 |
| --- | --- |
| [文档管理规范](documentation.md) | 分类、维护责任、更新时机、决策与归档规则 |
| [总体架构](architecture/overview.md) | 系统边界、进程关系、完整处理流程、设计取舍 |
| [前端设计](architecture/frontend.md) | Vue 组件、状态、轮询、页面归属、恢复勾选 |
| [后端与框架设计](architecture/backend.md) | Rust 宿主、Node 调度、压缩流水线、模块扩展、安全恢复 |
| [通信协议](architecture/protocol.md) | Tauri 命令、JSON Lines、操作与作业模式、错误语义 |
| [持久化与兼容性](architecture/persistence.md) | 配置布局、任务事件、锁、崩溃恢复、报告格式 |
| [开发与验证](development.md) | 环境、构建、测试矩阵、Git 与 Conventional Commits |
| [项目状态](project-status.md) | 接手基线、实际验证结果、已知限制和后续事项 |
| [职责扩展与 Cordis 评估](plans/resource-processing-and-cordis.md) | 多操作扩展瓶颈、官方论文依据、框架收益和阶段性建议；未实施部分明确标注 |
| [架构决策记录](decisions/README.md) | 重要设计变更的背景、方案、代价及替代关系 |

## 专题原始说明

- [桌面开发与发布](../desktop/README.md)：原生窗口开发、便携构建及测试入口。
- [资源核心目录](../resource-core/README.md)：源码组织和通用设施边界。
- [处理器模块开发](../resource-core/processors/README.md)：当前压缩接口、完整 schema 字段和扩展示例。
- [公共配置说明](../resource-core/config/README.md)：用户配置文件的位置与迁移入口。

## 按改动范围选择阅读路径

| 改动 | 必读专题 | 首要回归 |
| --- | --- | --- |
| 界面交互 | 前端设计、通信协议 | `desktop/tests/*.test.ts`，涉及原生流程时补 E2E |
| 编码器或参数 | 后端设计、模块开发、持久化 | `discovery`、`resources`、`compress`、`layout` |
| 任务、取消、续压 | 后端设计、通信协议、持久化 | `batch`、`desktop`、`resume` |
| 恢复与勾选 | 前端设计、持久化、后端设计 | `restore`、`restore-preview`、组件与原生测试 |
| 打包或依赖 | 总体架构、开发与验证、桌面 README | 类型检查、release 构建、原生 E2E |

表中核心测试名称对应 `resource-core/tests/<名称>.test.js`。
