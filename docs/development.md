# 开发与验证

本指南定义可重复的开发、测试与提交流程；当前环境及实际通过的检查见[项目状态](project-status.md)。应用运行依赖本机 Windows 编码器，其他系统上的跳过测试不能视为 Windows 验收通过。

## 环境与首次启动

完整桌面开发需要 Windows x64、Node.js 22.12+ 与 npm、Rust stable MSVC、Visual Studio C++ Build Tools、Windows SDK 和 WebView2 Runtime。先确认 `node --version`、`npm --version`、`cargo --version` 可用；存在版本管理器占位命令不等于工具已激活。

仓库通过 [`.nvmrc`](../.nvmrc) 固定开发用 Node 26.13.0，通过 [`rust-toolchain.toml`](../rust-toolchain.toml) 固定 Rust 1.99.1 与 `x86_64-pc-windows-msvc` 目标，通过 [`.vsconfig`](../.vsconfig) 记录 C++ 工作负载、MSVC x64/x86 和 Windows SDK 26100。Node 版本管理器不一定自动切换，使用 nvm 时可显式执行 `nvm use 26.13.0`。rustup 在仓库内自动识别工具链文件。

缺少 Windows 组件时，从 [Tauri 官方前置要求](https://v2.tauri.app/start/prerequisites/)进入 Microsoft C++ Build Tools 安装，在 Visual Studio Installer 导入 `.vsconfig`；Rust 使用[官方 rustup 安装器](https://rust-lang.org/tools/install/)，默认 host 选择 `x86_64-pc-windows-msvc`。Rust 安装会将 `%USERPROFILE%\.cargo\bin` 加入用户 PATH；已经打开的终端需重新打开，或仅在当前 PowerShell 执行 `$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path`。

受限沙箱可能重定向 LocalAppData，造成 nvm 误报“未安装/未激活”。先在普通用户终端确认真实版本与 PATH，再决定是否安装；不要据沙箱结果重复安装或改写全局配置。

在 `desktop/` 中执行：

```powershell
npm ci
npm run dev
```

`npm run dev` 通过 Tauri 启动 Vite 及原生窗口。`npm run dev:web` 只提供样式页面，浏览器没有 native API，不是完整业务测试环境。

全新 Git 克隆不含 `runtime/node.exe` 和根目录 EXE。首次可先执行 `npm run build` 生成便携布局；若先做原生调试，应把已安装且版本满足要求的 Node 可执行文件复制到 `runtime/node.exe`。`portable.mjs` 只在运行时缺失时复制当前 Node，不会自动升级已存在的运行时；替换运行时时同时核对其许可证文件。

## 命令与构建产物

| 目录 | 命令 | 用途 |
| --- | --- | --- |
| `desktop/` | `npm run build:web` | `vue-tsc --noEmit` 后执行 Vite 构建 |
| `desktop/` | `npm run typecheck` | 独立执行 `vue-tsc --noEmit`，包含前端、配置与测试类型 |
| `desktop/` | `npm run build` | Tauri release 构建，不生成安装包；前置执行 build:web，随后复制根目录 EXE |
| `desktop/` | `npm test` | Vitest + Vue Test Utils + jsdom |
| `desktop/` | `npm run test:e2e` | Playwright 连接真实 WebView2；先构建当前源码 |
| `resource-core/` | `npm test` | Node 内置测试框架，不需安装核心 npm 依赖 |
| 仓库根目录 | `.\runtime\node.exe --test resource-core/tests/*.test.js` | 使用便携 Node 运行同一核心套件 |
| 仓库根目录 | `.\runtime\node.exe resource-core/compress.js --help` | 查看自动生成的 CLI 参数 |

原生测试复制工具、生成样本、使用独立 WebView 用户目录和本机随机 CDP 端口；截图位于 `desktop/test-results/`。它使用系统 WebView2，无需另装 Playwright Chromium 浏览器。只对旧 EXE 跑 E2E 不能证明新源码构建正确。

开发 Node 与便携运行时可以不同：当前开发使用 Node 26.13.0，随附运行时保留 Node 24.19.0。核心套件验证开发 Node，原生 E2E 使用工具目录的便携 Node；不要把更新全局 Node 当作更新发布运行时。

## 依赖安装与安全修复

使用 `npm ci` 复现 `package-lock.json`，避免首次配置时无目的升级全部依赖。测试工具固定在 Vitest `~4.1.12`，用于修复旧 mocker 与线程池依赖的问题，保持 Vite 7 和现有组件测试 API。`js-beautify` 的 `glob` 覆盖到 `^14.0.2`，`minimatch` 覆盖到 `^11.0.1`，修复上游旧依赖链的审计问题。

这些 overrides 是临时的兼容修复；上游解除旧依赖约束后，移除前必须重跑组件测试、类型检查及 `npm audit`。升级依据见 [Vitest 安全公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8)和 [Vitest 4 迁移指南](https://v4.vitest.dev/guide/migration)。

`package.json` 的 `allowScripts` 仅批准 `esbuild@0.28.2` 的安装脚本；npm 11.20+ 会据此处理安装脚本许可。新版本提示未许可时，先审阅具体包及脚本，再更新许可，不使用全局放开所有依赖脚本的配置。`whatwg-encoding` 的弃用提示来自 jsdom 26 的传递依赖，不影响当前验证；不要仅为消除提示直接替换其内部实现。

## 按风险选择验证

| 修改范围 | 应执行的验证 |
| --- | --- |
| 纯文档 | 链接/命令/字段核对，`git diff --check`；不添加镜像测试 |
| Vue 交互与模型 | `npm test`、`npm run build:web`；原生 API 或完整流程变化补 E2E |
| Node 业务与文件安全 | 完整核心测试；定位时可先运行单文件 |
| schema 或配置格式 | 核心套件，动态控件组件测试；新增类型补原生流程 |
| Rust、桥接、打包、跨进程契约 | 核心测试、组件测试、当前源码 release 构建和原生 E2E |
| 编码器变更 | 真实格式样本、输出解码、大小与原文件保护、对应核心回归 |

没有数值覆盖率门槛，也没有配置 ESLint、Prettier、commitlint 或 CI。`build:web` 的类型检查不是 lint。缺少工具时明确记录未执行项，不将静态阅读替代为“测试通过”。

测试在系统临时目录写隔离副本；不要对用户配置、原素材、报告或历史任务执行测试。如果受限环境阻止 rename、链接或进程启动，先查看实际错误并验证环境影响，不能为了通过测试删除安全断言或改用真实素材目录。

## 核心测试地图

| 文件名（`resource-core/tests/`） | 重点 |
| --- | --- |
| `compress.test.js` | 图片编码、中文/空格路径、链接、另存、备份、CLI 校验 |
| `resources.test.js` | MP3 真实编码/解码、格式开关、配置基础行为 |
| `discovery.test.js` | 自动发现、schema、冲突、停用与扩展参数 |
| `layout.test.js` | 拆分配置、旧格式迁移、保存回滚、移动工具 |
| `batch.test.js` | 预览、取消、进度、CSV/JSON 报告、状态文件占用 |
| `desktop.test.js` | JSON Lines、工作进程、宿主退出后的安全取消 |
| `resume.test.js` | 固定清单、队列、失败副本所有权、任务锁和日志修复 |
| `restore.test.js` | 恢复哈希、冲突、字节一致、旧备份导出、中断恢复 |
| `restore-preview.test.js` | 只读预览、选择范围、哈希快照、CLI 选择文件 |

`portable.js` 是隔离复制辅助文件。前端测试见[前端设计](architecture/frontend.md)。

## Git 管理边界

本地默认分支为 `main`。跟踪源码、文档、锁文件、图标、现有三个编码器及 Node 许可证；编码器作为当前必要运行依赖保留。生成的根 EXE、Node 运行时、依赖目录、构建目录、个人配置、任务、报告和测试产物由 `.gitignore` 排除。

忽略不等于删除；这些文件仍可在本地使用。不要强制添加用户数据。新增工具或二进制时记录用途、来源、版本/哈希及许可信息，不能把本地纳入版本管理等同于已获得对外分发许可。当前已有编码器的来源记录仍需补齐，见项目状态。

提交前检查 `git status --short`、`git diff`、`git diff --cached --check` 和暂存文件列表。源码换行按 `.gitattributes` 处理，避免无关整文件格式化。任务分支可命名为 `feat/<主题>`、`fix/<主题>`、`docs/<主题>`；一个提交聚焦一个完整意图。

## Conventional Commits

所有新提交遵循 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/zh-hans/v1.0.0/)，本项目统一小写英文类型/范围和中文描述：

```text
<type>(<scope>): <中文动作描述>

可选正文：原因、行为变化、兼容性与验证。
```

scope 可省略。常用类型为 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci`、`perf`、`style`、`chore`、`revert`；范围建议 `ui`、`bridge`、`core`、`tasks`、`restore`、`config`、`processors`、`docs`、`repo`。新增功能用 feat，缺陷修复用 fix；界面功能变化不属于仅格式调整的 style。

示例：`fix(restore): 保留预览后被修改的目标文件`、`docs(architecture): 补充任务日志恢复流程`。破坏性变更使用 `!` 或 `BREAKING CHANGE:` 脚注，本项目要求同时写清迁移方式和受影响数据。规范由贡献流程遵守，当前未安装自动提交钩子。

PR 说明应包含具体问题、最终行为、关联问题、验证命令/结果、文档更新和兼容性影响；界面变化附截图。未执行或受阻的验证单独说明。
