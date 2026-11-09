# Repository Guidelines

## 项目语言与阅读顺序

产品为 **AssetToolbox 资源工具箱**，面向游戏等资源的压缩、图片与音频处理。沟通、文档、注释、界面及提交说明默认使用简体中文，代码标识符使用英文。

开始前阅读本文件、[文档索引](docs/README.md)、[项目状态](docs/project-status.md)、[总体架构](docs/architecture/overview.md)，检查 `git status` 和最近提交，再追踪对应源码与测试。扩展功能必读[扩展契约](docs/architecture/extensions.md)。不要将规划能力写成已经实现。

## 项目结构

- `desktop/src/`：Vue 3、TypeScript 界面；`desktop/src-tauri/`：Rust/Tauri 2 宿主。
- `resource-core/`：Node CommonJS 引擎、任务、恢复、配置和桌面桥接。
- `resource-types/`、`operations/`、`providers/` 位于核心目录内，分别定义格式识别、处理语义、工具实现；`framework/` 负责发现、schema 和进程调用。
- `resource-core/tests/`、`desktop/tests/`：核心、组件及原生 E2E 测试；`docs/`：架构、流程和决策。
- `resource-core/data/`：运行时配置、任务、报告，禁止提交。

## 开发命令与风格

Windows x64 环境按 `.nvmrc`、`rust-toolchain.toml`、`.vsconfig` 配置。先在 `resource-core/` 执行 `npm ci`，再在 `desktop/` 执行 `npm ci`。

核心目录：`npm test`。桌面目录：`npm run dev` 启动原生开发；`npm test` 跑组件测试；`npm run typecheck` 检查类型；`npm run build` 构建并校验便携依赖；`npm run test:e2e` 验证刚构建的 EXE。详细前提见[开发指南](docs/development.md)。

JS/TS/Rust 使用四空格，Vue 模板两空格，JS/TS 使用单引号和分号。组件用 PascalCase，函数及参数用 camelCase，扩展和步骤 ID 用 `[a-z][a-z0-9-]*`。TypeScript 严格模式；没有独立 lint/格式化工具。

## 扩展与文件安全

新功能遵循“资源类型—处理操作—实现提供方”；参数按步骤分为 `parameters` 与 `providerOptions`。验收策略属于操作，压缩才采用更小规则。提供方只处理临时文件，禁止直接修改素材；全部步骤成功才提交一次。保留哈希、原子替换、任务锁、按文件边界取消、显式恢复选择及冲突保护。

按用户要求，本次为全新项目契约：不读写或迁移旧配置、任务及旧接口；使用新 schema 和 `data/`。不接入 Cordis。后续契约变更必须升级版本并明确拒绝策略，参见 [ADR 0003](docs/decisions/0003-processing-contract.md)。

## 测试、文档与提交

核心用 Node 内置测试（`*.test.js`），组件用 Vitest（`*.test.ts`），原生用 Playwright（`*.spec.ts`）。无数值覆盖门槛；覆盖新增行为及文件安全边界，不删除安全断言来通过测试。仅用生成素材和隔离副本，不操作真实用户数据。

遵循[文档管理规范](docs/documentation.md)：行为、协议、格式或依赖变化同步更新对应专题、索引及项目状态，记录实际通过和未执行项。新 EXE 必须重新验证。

提交使用 Conventional Commits，例如 `feat(core)!: 实现资源处理流水线`。提交前检查暂存差异及 `git diff --cached --check`；PR 说明最终行为、验证结果、关联问题和文档更新，界面改动附截图。
