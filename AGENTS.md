# Repository Guidelines

## 项目语言

本项目以简体中文为主要语言。后续沟通、贡献文档、代码注释、界面文案及提交与 PR 说明默认使用中文。代码标识符、命令、路径和协议字段沿用既有命名，必要时保留英文技术术语。

## AI 阅读与开发顺序

开始任务前依次阅读本文件、[文档索引](docs/README.md)、[项目状态](docs/project-status.md)和[总体架构](docs/architecture/overview.md)，再按改动范围阅读[前端](docs/architecture/frontend.md)、[后端](docs/architecture/backend.md)、[通信协议](docs/architecture/protocol.md)及[持久化](docs/architecture/persistence.md)。检查 `git status` 和最近提交，再追踪入口、调用方、实现与测试，不凭文档推断代码已具备某功能。

修改围绕当前需求展开；核对兼容性与文件安全，完成必要验证并同步文档。记录实际通过、失败和未执行项，不把旧 EXE 的运行结果当成新源码构建验证。当前环境限制和后续事项以项目状态为准。

## 项目结构与模块组织

- `desktop/src/`：Vue 3 组件、TypeScript 模型与 API、CSS。
- `desktop/src-tauri/`：Rust/Tauri 2 宿主及原生权限，通过 JSON Lines 与 Node 通信。
- `resCompress/`：CommonJS 压缩、恢复、配置、任务持久化及桌面桥接代码。
- `resCompress/compressors/`：自动发现的压缩模块，包含 `config.js`、`index.js` 和编码器。新增模块时复制 `_template/`，遵循同级 `README.md`。
- `resCompress/tests/`、`desktop/tests/`：核心及界面测试。
- `docs/`：架构、协议、文档管理、开发流程与接手记录；`docs/decisions/` 保存重要决策。
- `ResourceCompressor.exe`、`runtime/node.exe`、`resCompress/` 共同组成便携应用；配置、任务和报告随工具保存。

## 构建、测试与开发命令

开发环境为 Windows x64，需要 Node.js 22.12+、Rust stable MSVC、Visual Studio C++ Build Tools、Windows SDK 和 WebView2。

开发版本与原生组件以 `.nvmrc`、`rust-toolchain.toml`、`.vsconfig` 为准。先用普通用户终端确认工具可用性；沙箱中的 nvm 检测可能受路径重定向影响。

在 `desktop/` 下执行：

- `npm ci`：按锁文件安装前端和 Tauri 依赖。
- `npm run dev`：启动 Vite 和 Tauri 原生窗口。
- `npm run dev:web`：仅在浏览器中调试样式，不支持原生调用。
- `npm run build:web`：检查 TypeScript 并打包前端。
- `npm run typecheck`：独立检查前端、测试及配置的 TypeScript 类型。
- `npm run build`：构建发布版，并将 EXE 复制到仓库根目录。
- `npm test`：运行 Vitest 组件测试。
- `npm run test:e2e`：通过 Playwright 测试原生 WebView2，须先构建。

在 `resCompress/` 下执行 `npm test`，运行 Node 内置测试框架的核心测试。

若系统 Node/npm 尚未激活，可在仓库根目录用 `.\runtime\node.exe --test resCompress/tests/*.test.js` 验证核心。完整命令前提与验证矩阵见[开发与验证](docs/development.md)。

## 代码风格与命名

遵循相邻代码：JavaScript、TypeScript、Rust 使用四空格缩进，Vue 模板使用两空格；JavaScript 和 TypeScript 使用单引号与分号。核心保留 CommonJS，前端使用 ES 模块。Vue 组件使用 PascalCase，函数和配置键使用 camelCase，Rust 函数使用 snake_case。模块 ID 遵循 `[a-z][a-z0-9_-]*`。TypeScript 已启用严格检查，尚未配置独立格式化或 lint 工具。

## 测试要求

核心测试命名为 `*.test.js`，组件测试为 `*.test.ts`，原生测试为 `*.spec.ts`。未设置数值覆盖率门槛；应覆盖变更行为，重点检查冲突保护、取消、续压、重试和恢复。使用临时目录、生成样本和隔离的便携副本，不得操作真实用户素材或既有历史记录。原生测试截图保存到 `desktop/test-results/`。

## 提交与 PR 规范

本地默认分支为 `main`。所有新提交必须遵循 Conventional Commits：`<type>(<scope>): <中文描述>`，scope 可省略；类型及范围使用小写英文，如 `fix(restore): 保留已修改的目标文件`。功能用 `feat`、修复用 `fix`、文档用 `docs`；破坏性变更使用 `!` 或 `BREAKING CHANGE:` 并说明迁移。详细类型及示例见[开发与验证](docs/development.md)。

提交前审查暂存差异、执行 `git diff --cached --check`，不纳入忽略的用户数据或生成产物。PR 说明问题与最终行为、关联问题、验证命令及结果、兼容性和文档更新；界面变更附截图。

## 文档维护要求

遵循[文档管理规范](docs/documentation.md)。行为、协议、数据格式、构建命令变化必须在同一提交或 PR 中更新对应文档；新增或移动文档同步索引与链接。重要架构改变使用[决策模板](docs/decisions/template.md)，明确状态、取舍和兼容策略。每次开发交接更新项目状态中的验证结果、未完成事项和下一步，不保存聊天流水或真实用户路径。每项规则只在一个位置完整维护，其余使用链接引用。

## 文件安全与兼容性

保留既有配置和任务格式、哈希校验、原子写入及按文件边界取消的机制。编码器仅处理临时输入与输出；模块 schema 统一驱动界面与 CLI。预览不保存配置或改写用户素材；恢复空选择不能转换为省略选择。区分临时作业 ID 与持久任务，不绕过任务锁。不要将个人配置、报告、任务日志或测试产物纳入提交。
