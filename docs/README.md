# 开发文档索引

本目录说明 AssetToolbox 资源工具箱的当前设计、开发约束与接手状态。面向使用者的操作步骤继续放在[根目录 README](../README.md)，避免同一规则在多处分别维护。

## 首次接手

按顺序阅读 [AGENTS.md](../AGENTS.md)、[项目状态](project-status.md)、[总体架构](architecture/overview.md)，再根据任务阅读对应专题。开始修改前，核对专题列出的源码与测试；源码和文档不一致时先确认实际行为，并在本次变更中修正文档。

| 文档 | 内容及适用任务 |
| --- | --- |
| [文档管理规范](documentation.md) | 分类、维护责任、更新时机、决策与归档规则 |
| [总体架构](architecture/overview.md) | 系统边界、进程关系、完整处理流程、设计取舍 |
| [前端设计规范](design/frontend-design.md) | 桌面软件的设计主张、浅色/深色令牌、窗口骨架、组件、交互约定、状态语义与浏览器调试；任何界面改动必读 |
| [前端架构](architecture/frontend.md) | 源码结构、工作台状态、作业生命周期、请求映射、步骤编辑与恢复勾选 |
| [后端与框架设计](architecture/backend.md) | Rust 宿主、Node 调度、处理流水线、提供方扩展、安全恢复 |
| [扩展契约](architecture/extensions.md) | 类型/操作/提供方、按操作适配器、公共与专属参数、版本及新增实现示例 |
| [音频处理](architecture/audio.md) | 分析、固定增益、响度归一化、峰值策略、质量边界和报告 |
| [提供方依赖管理](architecture/dependencies.md) | 固定核验清单、HTTPS/摘要校验、自动安装更新、取消与不可变目录 |
| [通信协议](architecture/protocol.md) | Tauri 命令、JSON Lines、操作与作业模式、错误语义 |
| [统一应用接口](architecture/application.md) | 公共作业 /2、唯一业务实现、启动上下文、跨入口访问与版本拒绝 |
| [外部 Agent 接入](architecture/automation.md) | 共享应用 API、结构化 CLI、本地 MCP、启动权限、幂等与分页查询 |
| [本机 HTTP 与 MCP HTTP](architecture/http.md) | 统一应用上下文、独立/联合启动、令牌、Streamable HTTP、生命周期与边界 |
| [持久化与版本契约](architecture/persistence.md) | 新 schema、步骤快照、锁、崩溃恢复、报告格式 |
| [开发与验证](development.md) | 环境、构建、测试矩阵、Git 与 Conventional Commits |
| [分发核对](distribution.md) | MIT 源码发布范围、历史清理、提供方许可与二进制放行条件 |
| [第三方声明](../THIRD_PARTY_NOTICES.md) | 来源、版本、许可证及当前分发结论 |
| [项目状态](project-status.md) | 接手基线、实际验证结果、已知限制和后续事项 |
| [职责扩展与 Cordis 评估](plans/resource-processing-and-cordis.md) | 多操作扩展瓶颈、官方论文依据、框架收益和阶段性建议；历史评估；当前契约已实现，Cordis 未接入 |
| [架构决策记录](decisions/README.md) | 重要设计变更的背景、方案、代价及替代关系 |

历史备选：[保留 SAC 的独立 Windows 开发环境](archive/windows-native-validation-vm.md)。方案未实施；用户已选择在本机完成原生验证，归档内容不属于当前待办。

## 专题原始说明

- [桌面开发与发布](../desktop/README.md)：原生窗口开发、便携构建及测试入口。
- [资源核心目录](../resource-core/README.md)：源码组织和通用设施边界。
- [扩展契约](architecture/extensions.md)：开发资源类型、操作及提供方的入口。

## 按改动范围选择阅读路径

| 改动 | 必读专题 | 首要回归 |
| --- | --- | --- |
| 界面视觉或交互 | 前端设计规范、前端架构、通信协议 | `desktop/tests/*.test.ts`，1220×850 与 840×620 截图；涉及原生流程时补 E2E |
| 编码器或参数 | 后端设计、扩展契约、持久化 | `adapters`、`contract`、`resize`、`resources`、`compress` |
| 音频测量或处理 | 音频专题、扩展契约、依赖管理 | 核心 audio、前端 audio.test.ts、原生 audio.spec.ts |
| 任务、取消、续跑 | 后端设计、通信协议、持久化 | `batch`、`desktop`、`resume` |
| CLI、MCP、HTTP 或外部 Agent | 统一应用接口、外部 Agent 接入、本机 HTTP、通信协议、持久化 | 核心 `application`、`unified`、`http`、`desktop` 及 `agent-mcp` 官方客户端测试 |
| 恢复与勾选 | 前端架构、持久化、后端设计 | `restore`、`restore-preview`、组件与原生测试 |
| 打包或依赖 | 总体架构、依赖管理、开发与验证、桌面 README | 核心 dependencies、类型检查、release 构建、原生 E2E |

表中核心测试名称对应 `resource-core/tests/<名称>.test.js`。
