# Repository Guidelines

## 项目语言与阅读顺序

产品为 **AssetToolbox 资源工具箱**，面向游戏等资源的压缩、图片与音频处理。沟通、文档、注释、界面及提交说明默认使用简体中文，代码标识符使用英文。

开始前阅读本文件、[文档索引](docs/README.md)、[项目状态](docs/project-status.md)、[总体架构](docs/architecture/overview.md)，检查 `git status` 和最近提交，再追踪对应源码与测试。扩展功能必读[扩展契约](docs/architecture/extensions.md)；界面改动必读[前端设计规范](docs/design/frontend-design.md)。不要将规划能力写成已经实现。

## 项目结构

- `desktop/src/`：Vue 3、TypeScript 界面；`desktop/src-tauri/`：Rust/Tauri 2 宿主。
- `resource-core/`：Node CommonJS 引擎、任务、恢复、配置和桌面桥接。
- `resource-types/`、`operations/`、`providers/` 位于核心目录内，分别定义格式识别、处理语义、工具实现；`framework/` 负责发现、schema 和进程调用。
- `resource-core/tests/`、`desktop/tests/`：核心、组件及原生 E2E 测试；`docs/`：架构、流程和决策。
- `resource-core/data/`：运行时配置、任务、报告，禁止提交。
- `resource-core/application/`：统一应用服务、共享作业与 HTTP API；`agent-mcp/`：独立 stdio/HTTP MCP 包，`examples/`：接入样例。

## 开发命令与风格

Windows x64 环境按 `.nvmrc`、`rust-toolchain.toml`、`.vsconfig` 配置。先在 `resource-core/` 执行 `npm ci`，再在 `desktop/` 执行 `npm ci`。

核心目录：`npm run test:source` 不要求外部编码器；`npm run test:codecs` 验证真实工具；`npm test` 全量执行，缺工具明确失败。桌面目录：`npm run dev` 启动原生开发；`npm test` 跑组件测试；`npm run typecheck` 检查类型；`npm run build` 构建并校验便携依赖；`npm run test:e2e` 验证刚构建的 EXE；`npm run test:e2e:network` 单独验证真实下载安装/更新。详细前提见[开发指南](docs/development.md)。

应用接口改动必读[统一应用接口](docs/architecture/application.md)、[自动化专题](docs/architecture/automation.md)、[HTTP 专题](docs/architecture/http.md)及 [ADR 0009](docs/decisions/0009-agent-interfaces.md)/[0010](docs/decisions/0010-local-http.md)/[0011](docs/decisions/0011-unified-application.md)。MCP 目录独立执行 `npm ci --ignore-scripts`、`npm test`；保持官方 SDK 锁文件。全部 CLI（含快捷命令）、桌面桥接、HTTP 和 MCP 必须复用 ApplicationService 的同一套 /7 公共作业动作；禁止桌面专用 start/poll 分支或入口直接调用 JobSession/引擎。统一 jobId/taskId、幂等提交和分页结果，权限及生命周期由启动上下文注入，MCP schema 取自 contract.js；不能通过 shell 拼接参数或各写一套处理逻辑。权限来自启动上下文，禁止工具参数扩权或通过 HTTP 暴露桌面设置。转换另存或授权备份覆盖，恢复带显式预览哈希。保留幂等键、分页和跨入口锁；stdio 断连取消，HTTP 连接断开不取消已提交作业，服务退出才请求取消自己拥有的作业。保留默认 stdio，HTTP 只能显式启动、回环监听并验证令牌/Host/Origin/正文上限；MCP 两种传输共用工具工厂，HTTP 每请求创建协议实例。不要把应用目录限制描述为 OS 沙箱。

JS/TS/Rust 使用四空格，Vue 模板两空格，JS/TS 使用单引号和分号。组件用 PascalCase，函数及参数用 camelCase，扩展和步骤 ID 用 `[a-z][a-z0-9-]*`。TypeScript 严格模式；没有独立 lint/格式化工具。

## 扩展与文件安全

新功能遵循“资源类型—处理操作—实现提供方”；参数按步骤分为 `parameters` 与 `providerOptions`。验收策略属于操作，压缩才采用更小规则。提供方只处理临时文件，禁止直接修改素材；全部步骤成功才提交一次。保留哈希、原子替换、任务锁、按文件边界取消、显式恢复选择及冲突保护。

提供方使用 API 2 的 `adapters[operationId]`，每项独立声明资源类型、schema、execute 和 version；依赖与 prepare 留在提供方层。不要重复定义 supports 或顶层执行/参数接口。步骤固定适配器版本，同操作切换提供方保留公共参数；详见[ADR 0007](docs/decisions/0007-operation-adapters.md)。

按用户要求，本次为全新项目契约：不读写或迁移旧配置、任务及旧接口；使用新 schema 和 `data/`。不接入 Cordis。后续契约变更必须升级版本并明确拒绝策略，参见 [ADR 0003](docs/decisions/0003-processing-contract.md)。

## 测试、文档与提交

新增或修改统一应用能力，必须同步桌面可操作流程、CLI 命令/帮助、MCP stdio 与 HTTP 工具、HTTP 访问入口、schema、权限及跨入口行为测试；入口只适配，不能复制业务实现。权限不足可统一明确拒绝，不能用漏入口代替权限控制；窗口、主题、文件对话框等专属功能仅放对应入口。服务相关改动必读[服务管理与入口覆盖](docs/architecture/service-management.md)及 [ADR 0016](docs/decisions/0016-service-management.md)。service-* 共用核心服务管理，stdio 由 Agent 宿主启动；服务跟随启动入口退出，不因离开页面或关闭观察窗口停止。policy/2 的 allowServiceManagement 默认 false，Agent 必须与已配置权限完全一致，不能扩权；令牌不进入响应或日志。

核心用 Node 内置测试（`*.test.js`），组件用 Vitest（`*.test.ts`），原生用 Playwright（`*.spec.ts`）。无数值覆盖门槛；覆盖新增行为及文件安全边界，不删除安全断言来通过测试。仅用生成素材和隔离副本，不操作真实用户数据。

遵循[文档管理规范](docs/documentation.md)：行为、协议、格式或依赖变化同步更新对应专题、索引及项目状态，记录实际通过和未执行项。项目状态只保留当前基线、最近验证摘要、限制及优先待办，目标不超过 100 行；逐轮证据写入 `docs/verification/日期-主题.md`，旧状态放 `docs/archive/`，禁止继续在状态页累加历史章节。新 EXE 必须重新验证。

提交使用 Conventional Commits，例如 `feat(core)!: 实现资源处理流水线`。提交前检查暂存差异及 `git diff --cached --check`；PR 说明最终行为、验证结果、关联问题和文档更新，界面改动附截图。

## 来源、许可与发布

项目自有源码使用 MIT，第三方许可见 [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md)。提供方必须登记官方获取渠道、安装说明、版本与许可；缺依赖需在前端可见。对外发布前执行[分发核对](docs/distribution.md)，不能把本地可运行视为允许分发。当前仅发布私有源码仓库，禁止上传第三方 EXE/DLL、node_modules 或包含这些文件的历史备份。

自动安装依赖必读[依赖管理](docs/architecture/dependencies.md)：清单固定版本、来源与摘要，前端仅传提供方 ID；校验后写入独立目录并原子启用，不覆盖手动文件或运行中的依赖，不放宽 TLS、摘要、解包和文件安全断言。


音频扩展必读[音频专题](docs/architecture/audio.md)及 [ADR 0008](docs/decisions/0008-audio-observation.md)：目录 API 3，操作 API 2 新增 observe/preserveOriginal；纯分析禁止素材写入，音频转换必须另存或备份。仅固定增益，超峰限制或失败，不自动动态压缩；测量与未达目标、重编码和元数据损失必须前端可见。FFmpeg 为手动依赖，不放宽自动安装校验。

## 测试分层与存储维护

相关改动必读[测试分层](docs/testing.md)、[存储维护](docs/architecture/storage.md)及 [ADR 0012](docs/decisions/0012-storage-retention-and-test-layers.md)。源码 CI 不代替本地编码器或原生验收；新增核心测试必须登记分层清单，不通过缺依赖自动跳过。存储默认保留 30 天，只允许预览后显式选择清理；保护素材、输出、任务、备份、依赖和幂等身份，禁止递归删任务目录。维护动作只允许受信任本地上下文，现有 policy 不授权全局清理；保留摘要重验、锁、retention 记录和 RESULTS_EXPIRED 语义。


作业中心相关改动必读[作业中心与入口冲突](docs/architecture/job-center.md)。观察状态独立于本会话 ActiveJob；关闭观察窗口或离开页面不能取消其他入口作业。资源感知队列支持 1–8 项并行（默认 2）、100 个未结束项；预算仅受信任本地上下文在全局空闲时修改，policy 入口拒绝。队列改动必读[持久队列与有限并行](docs/architecture/queue.md)及 [ADR 0014](docs/decisions/0014-resource-aware-concurrency.md)/[0015](docs/decisions/0015-configurable-concurrency.md)。由核心推导资源并分配稳定槽位，整体授予；保留冲突 FIFO、防饥饿、维护屏障、原持有会话、启动预约、worker 独立占用、退出确认及取消边界。submit 不能指定资源、槽位或预算；CPU 建议不是线程/内存配额，不随查询自动应用。
