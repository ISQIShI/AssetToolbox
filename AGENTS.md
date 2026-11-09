# Repository Guidelines

## 项目语言

本项目以简体中文为主要语言。后续沟通、贡献文档、代码注释、界面文案及提交与 PR 说明默认使用中文。代码标识符、命令、路径和协议字段沿用既有命名，必要时保留英文技术术语。

## 项目结构与模块组织

- `desktop/src/`：Vue 3 组件、TypeScript 模型与 API、CSS。
- `desktop/src-tauri/`：Rust/Tauri 2 宿主及原生权限，通过 JSON Lines 与 Node 通信。
- `resCompress/`：CommonJS 压缩、恢复、配置、任务持久化及桌面桥接代码。
- `resCompress/compressors/`：自动发现的压缩模块，包含 `config.js`、`index.js` 和编码器。新增模块时复制 `_template/`，遵循同级 `README.md`。
- `resCompress/tests/`、`desktop/tests/`：核心及界面测试。
- `ResourceCompressor.exe`、`runtime/node.exe`、`resCompress/` 共同组成便携应用；配置、任务和报告随工具保存。

## 构建、测试与开发命令

开发环境为 Windows x64，需要 Node.js 22.12+、Rust stable MSVC、Visual Studio C++ Build Tools、Windows SDK 和 WebView2。

在 `desktop/` 下执行：

- `npm ci`：按锁文件安装前端和 Tauri 依赖。
- `npm run dev`：启动 Vite 和 Tauri 原生窗口。
- `npm run dev:web`：仅在浏览器中调试样式，不支持原生调用。
- `npm run build:web`：检查 TypeScript 并打包前端。
- `npm run build`：构建发布版，并将 EXE 复制到仓库根目录。
- `npm test`：运行 Vitest 组件测试。
- `npm run test:e2e`：通过 Playwright 测试原生 WebView2，须先构建。

在 `resCompress/` 下执行 `npm test`，运行 Node 内置测试框架的核心测试。

## 代码风格与命名

遵循相邻代码：JavaScript、TypeScript、Rust 使用四空格缩进，Vue 模板使用两空格；JavaScript 和 TypeScript 使用单引号与分号。核心保留 CommonJS，前端使用 ES 模块。Vue 组件使用 PascalCase，函数和配置键使用 camelCase，Rust 函数使用 snake_case。模块 ID 遵循 `[a-z][a-z0-9_-]*`。TypeScript 已启用严格检查，尚未配置独立格式化或 lint 工具。

## 测试要求

核心测试命名为 `*.test.js`，组件测试为 `*.test.ts`，原生测试为 `*.spec.ts`。未设置数值覆盖率门槛；应覆盖变更行为，重点检查冲突保护、取消、续压、重试和恢复。使用临时目录、生成样本和隔离的便携副本，不得操作真实用户素材或既有历史记录。原生测试截图保存到 `desktop/test-results/`。

## 提交与 PR 规范

当前副本没有 Git 元数据，无法核实历史提交惯例。建议提交标题简短、明确描述动作，可带范围，例如 `fix(restore): 保留已修改的目标文件`。PR 应说明行为变化、关联相关问题、列出验证命令与结果；界面变更附截图。

## 文件安全与兼容性

保留既有配置和任务格式、哈希校验、原子写入及按文件边界取消的机制。编码器仅处理临时输入与输出。不要将个人配置、报告、任务日志或测试产物纳入提交。
