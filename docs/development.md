# 开发与验证

本指南定义可重复的开发、测试与提交流程；当前环境及实际通过的检查见[项目状态](project-status.md)。应用运行依赖本机 Windows 编码器，其他系统上的跳过测试不能视为 Windows 验收通过。

## 环境与首次启动

完整桌面开发需要 Windows x64、Node.js 22.12+ 与 npm、Rust stable MSVC、Visual Studio C++ Build Tools、Windows SDK 和 WebView2 Runtime。先确认 `node --version`、`npm --version`、`cargo --version` 可用；存在版本管理器占位命令不等于工具已激活。

仓库通过 [`.nvmrc`](../.nvmrc) 固定开发用 Node 26.13.0，通过 [`rust-toolchain.toml`](../rust-toolchain.toml) 固定 Rust 1.99.1 与 `x86_64-pc-windows-msvc` 目标，通过 [`.vsconfig`](../.vsconfig) 记录 C++ 工作负载、MSVC x64/x86 和 Windows SDK 26100。Node 版本管理器不一定自动切换，使用 nvm 时可显式执行 `nvm use 26.13.0`。rustup 在仓库内自动识别工具链文件。

缺少 Windows 组件时，从 [Tauri 官方前置要求](https://v2.tauri.app/start/prerequisites/)进入 Microsoft C++ Build Tools 安装，在 Visual Studio Installer 导入 `.vsconfig`；Rust 使用[官方 rustup 安装器](https://rust-lang.org/tools/install/)，默认 host 选择 `x86_64-pc-windows-msvc`。Rust 安装会将 `%USERPROFILE%\.cargo\bin` 加入用户 PATH；已经打开的终端需重新打开，或仅在当前 PowerShell 执行 `$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path`。

受限沙箱可能重定向 LocalAppData，造成 nvm 误报“未安装/未激活”。先在普通用户终端确认真实版本与 PATH，再决定是否安装；不要据沙箱结果重复安装或改写全局配置。

先在 `resource-core/` 执行 `npm ci` 安装 Sharp 及平台原生依赖，再在 `desktop/` 中执行：

```powershell
npm ci
npm run dev
```

`npm run dev` 通过 Tauri 启动 Vite 及原生窗口。`npm run dev:web` 在浏览器中打开界面；没有 native API 时自动使用模拟核心，只用于调整界面，不是业务测试环境，见[前端设计规范](design/frontend-design.md#在浏览器中调试界面)。

Vite 热更新只监听前端相关文件，排除 `src-tauri/`，避免 Windows 原生构建锁定产物时触发 `EBUSY` 并关闭预览服务。

全新 Git 克隆不含 `runtime/node.exe` 和根目录 EXE。首次可先执行 `npm run build` 生成便携布局；若先做原生调试，应把已安装且版本满足要求的 Node 可执行文件复制到 `runtime/node.exe`。`portable.mjs` 只在运行时缺失时复制当前 Node，不会自动升级已存在的运行时；替换运行时时同时核对其许可证文件。

## 命令与构建产物

| 目录 | 命令 | 用途 |
| --- | --- | --- |
| `desktop/` | `npm run build:web` | `vue-tsc --noEmit` 后执行 Vite 构建 |
| `desktop/` | `npm run typecheck` | 独立执行 `vue-tsc --noEmit`，包含前端、配置与测试类型 |
| `desktop/` | `npm run build` | Tauri release 构建，不生成安装包；前置执行 build:web，随后复制根目录 EXE |
| `desktop/` | `npm test` | Vitest + Vue Test Utils + jsdom |
| `desktop/` | `npm run test:e2e` | Playwright 连接真实 WebView2；先构建当前源码 |
| `resource-core/` | `npm test` | Node 全量测试；核心依赖及真实本地编码器必须齐全 |
| `resource-core/` | `npm run test:source` / `npm run test:codecs` | 无外部 EXE 源码测试 / 真实编码器验收 |
| `desktop/` | `npm run test:e2e:network` | 单独验收真实依赖下载、校验、安装及更新 |
| `agent-mcp/` | `npm ci --ignore-scripts` | 安装独立的官方 MCP SDK 与测试客户端，锁定来源和摘要 |
| `agent-mcp/` | `npm test` | 官方客户端真实 stdio / Streamable HTTP、新旧协议、执行与生命周期测试 |
| 仓库根目录 | `.\runtime\node.exe --test resource-core/tests/*.test.js` | 使用便携 Node 运行同一核心套件 |
| 仓库根目录 | `.\runtime\node.exe resource-core/cli.js --help` | 查看流水线 CLI 用法 |

原生测试复制工具、生成样本、使用独立 WebView 用户目录和本机随机 CDP 端口；截图位于 `desktop/test-results/`。它使用系统 WebView2，无需另装 Playwright Chromium 浏览器。只对旧 EXE 跑 E2E 不能证明新源码构建正确。

公共应用接口的核心验收为 `node --test tests/application.test.js tests/unified.test.js`（resource-core 目录）：含生成图片/音频、目录权限、幂等、分页、恢复/导出、上下文所有权/生命周期、版本拒绝及跨入口锁。MCP 使用 Node 24+，需额外安装 agent-mcp 依赖；不会由桌面构建隐式安装。配置和 CLI 示例见[自动化专题](architecture/automation.md)。

HTTP 改动增加 `node --test tests/http.test.js`：真实回环 socket、令牌/Host/Origin、请求上限、状态码、生命周期与独立入口；联合服务还需运行 MCP 的 HTTP 官方客户端测试，其中五入口联合用例覆盖真实桌面 JSON Lines、CLI、stdio MCP、HTTP 与 HTTP MCP；原生 E2E 另比较 EXE/CLI 状态和重启后的同一 jobId。仅在测试中使用随机端口和随机令牌，不把开发凭据提交到仓库。实际服务启动见[HTTP 指南](architecture/http.md)。

依赖管理验收：`resource-core/` 下 `node --test tests/dependencies.test.js` 使用合成归档测试来源/摘要、路径与解包边界、失败保护和取消；原生 E2E 还从 RareWares/npm registry 真实安装 LAME/Sharp 并更新，必须联网。安装等待按每包最多 60 秒及运行探测预留，Sharp 五个包最多等待 330 秒；普通作业仍为 30 秒。更换核验清单时同步来源记录与锁文件，不能为测试通过跳过校验。

开发 Node 与便携运行时可以不同：当前开发使用 Node 26.13.0，随附运行时保留 Node 24.19.0。完整核心测试需要先按提供方 provenance.json 安装三个编码器和 LAME 伴随 DLL；缺少真实工具不能当作完整回归通过。核心套件验证开发 Node，原生 E2E 使用工具目录的便携 Node；不要把更新全局 Node 当作更新发布运行时。

## 依赖安装与安全修复

核心锁定 Sharp 0.35.5，依赖随 `resource-core/node_modules/` 一起发布；构建脚本使用便携 Node 运行只读加载检查。Sharp 用于 PNG/JPEG 缩放，官方行为见 [resize API](https://sharp.pixelplumbing.com/api-resize/) 和 [安装说明](https://sharp.pixelplumbing.com/install/)。代码通过短生命周期子进程加载原生库，避免 Windows 中主进程长期持有 DLL 文件锁。

使用 `npm ci` 复现 `package-lock.json`，避免首次配置时无目的升级全部依赖。测试工具固定在 Vitest `~4.1.12`，用于修复旧 mocker 与线程池依赖的问题，保持 Vite 7 和现有组件测试 API。`js-beautify` 的 `glob` 覆盖到 `^14.0.2`，`minimatch` 覆盖到 `^11.0.1`，修复上游旧依赖链的审计问题。

这些 overrides 是临时的兼容修复；上游解除旧依赖约束后，移除前必须重跑组件测试、类型检查及 `npm audit`。升级依据见 [Vitest 安全公告](https://github.com/vitest-dev/vitest/security/advisories/GHSA-qxg6-89mg-rqv8)和 [Vitest 4 迁移指南](https://v4.vitest.dev/guide/migration)。

界面使用系统字体，不打包字体文件；图标是 `desktop/src/components/Icon.vue` 中自绘的 SVG 路径，没有图标库依赖。原生窗口关闭了系统边框，标题栏由前端绘制，所需窗口权限登记在 `desktop/src-tauri/capabilities/default.json`，增减权限时同步[前端设计规范](design/frontend-design.md#窗口骨架)。

桌面运行依赖 `reka-ui` 精确锁定 2.11.0（MIT），只作为无样式的行为层，由 `SelectBox.vue`、`Tip.vue`、`ConfirmDialog.vue`、`StepMenu.vue` 封装后使用；`@floating-ui/dom` 精确锁定 1.8.0（MIT），只用于“添加步骤”选择器的定位；升级时同步[前端设计规范](design/frontend-design.md#下拉选择与提示)、[ADR 0018](decisions/0018-headless-ui-primitives.md)与第三方声明，并重跑原生 E2E（下拉交互只有原生测试覆盖）。

`package.json` 的 `allowScripts` 仅批准 `esbuild@0.28.2` 的安装脚本；npm 11.20+ 会据此处理安装脚本许可。新版本提示未许可时，先审阅具体包及脚本，再更新许可，不使用全局放开所有依赖脚本的配置。`whatwg-encoding` 的弃用提示来自 jsdom 26 的传递依赖，不影响当前验证；不要仅为消除提示直接替换其内部实现。

## 按风险选择验证

| 修改范围 | 应执行的验证 |
| --- | --- |
| 纯文档 | 链接/命令/字段核对，`git diff --check`；不添加镜像测试 |
| Vue 交互、样式与模型 | `npm test`、`npm run build:web`，按设计规范核对清单截图；原生 API 或完整流程变化补 E2E |
| Node 业务与文件安全 | 完整核心测试；定位时可先运行单文件 |
| schema 或配置格式 | 核心套件，动态控件组件测试；新增类型补原生流程 |
| Rust、桥接、打包、跨进程契约 | 核心测试、组件测试、当前源码 release 构建和原生 E2E |
| 编码器变更 | 真实格式样本、输出解码、大小与原文件保护、对应核心回归 |

没有数值覆盖率门槛，也没有配置 ESLint、Prettier 或 commitlint。源码 CI 已配置，见[测试分层](testing.md)。`build:web` 的类型检查不是 lint。缺少工具时明确记录未执行项，不将静态阅读替代为“测试通过”。

测试在系统临时目录写隔离副本；不要对用户配置、原素材、报告或历史任务执行测试。如果受限环境阻止 rename、链接或进程启动，先查看实际错误并验证环境影响，不能为了通过测试删除安全断言或改用真实素材目录。

## 核心测试地图

| 文件名（`resource-core/tests/`） | 重点 |
| --- | --- |
| `compress.test.js` | 图片编码、中文/空格路径、链接、另存、备份、CLI 校验 |
| `resources.test.js` | MP3 真实编码/解码、格式开关、配置基础行为 |
| `contract.test.js` | 三层发现、参数命名空间、组合/版本拒绝、原子配置 |
| `resize.test.js` | 真实缩放、透明度、方向、尺寸、顺序、失败回滚及恢复 |
| `batch.test.js` | 预览、取消、进度、CSV/JSON 报告、状态文件占用 |
| `desktop.test.js` | JSON Lines、工作进程、宿主退出后的安全取消 |
| `resume.test.js` | 固定清单、队列、失败副本所有权、任务锁和日志修复 |
| `restore.test.js` | 恢复哈希、冲突、字节一致、独立备份导出、中断恢复 |
| `restore-preview.test.js` | 只读预览、选择范围、哈希快照、CLI 选择文件 |

`portable.js` 是隔离复制辅助文件。前端测试见[前端设计](architecture/frontend.md)。

## Git 管理边界

本地默认分支为 `main`。跟踪源码、文档、锁文件、图标及许可记录；第三方 EXE/DLL 仅在本地安装，不进入源码或发布历史。生成的根 EXE、Node 运行时、依赖目录、构建目录、个人配置、任务、报告和测试产物由 `.gitignore` 排除。

忽略不等于删除；这些文件仍可在本地使用。不要强制添加用户数据。新增工具或二进制时记录用途、来源、版本/哈希及许可信息，不能把本地纳入版本管理等同于已获得对外分发许可。当前来源记录与未放行项见[分发核对](distribution.md)。

提交前检查 `git status --short`、`git diff`、`git diff --cached --check` 和暂存文件列表。源码换行按 `.gitattributes` 处理，避免无关整文件格式化。任务分支可命名为 `feat/<主题>`、`fix/<主题>`、`docs/<主题>`；一个提交聚焦一个完整意图。

## Conventional Commits

所有新提交遵循 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/zh-hans/v1.0.0/)，本项目统一小写英文类型/范围和中文描述：

```text
<type>(<scope>): <中文动作描述>

可选正文：原因、行为变化、兼容性与验证。
```

scope 可省略。常用类型为 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci`、`perf`、`style`、`chore`、`revert`；范围建议 `ui`、`bridge`、`core`、`tasks`、`restore`、`config`、`providers`、`docs`、`repo`。新增功能用 feat，缺陷修复用 fix；界面功能变化不属于仅格式调整的 style。

示例：`fix(restore): 保留预览后被修改的目标文件`、`docs(architecture): 补充任务日志恢复流程`。破坏性变更使用 `!` 或 `BREAKING CHANGE:` 脚注，本项目要求同时写清格式影响及读取/拒绝策略；当前新契约明确不迁移历史数据。规范由贡献流程遵守，当前未安装自动提交钩子。

PR 说明应包含具体问题、最终行为、关联问题、验证命令/结果、文档更新和兼容性影响；界面变化附截图。未执行或受阻的验证单独说明。

## 音频测试前提

按“工具”页指引安装 FFmpeg/FFprobe 9.0.2 至 `resource-core/providers/ffmpeg/`；无需系统 PATH。二进制仅本地使用。核心 `audio.test.js` 和原生 `audio.spec.ts` 依赖真实工具，缺失时应安装，不跳过验收。前端 `audio.test.ts` 不需要外部工具。全量命令不变，原生 E2E 必须使用刚构建的根目录 EXE。

独立浏览器集成验证（不能替代原生验收）：先在 desktop 执行 `npm run build:web`，再于 PowerShell 设置 `$env:ASSET_TOOLBOX_AUDIO_BROWSER='1'` 并执行 `npx playwright test audio.spec.ts`。使用已安装 Edge、生产前端、隔离真实核心与 FFmpeg，只模拟原生窗口 IPC。完成后执行 `Remove-Item Env:ASSET_TOOLBOX_AUDIO_BROWSER`；普通 `npm run test:e2e` 必须不带该变量。

若 Rust 宏 DLL 加载报 Windows 4551，先只读检查 CodeIntegrity/Operational 与 `CiTool.exe --list-policies --json`，确认具体策略，不能仅凭“Enterprise signing level”推断设备受组织管理。本次实际阻断来自 Smart App Control 的 VerifiedAndReputableDesktop 策略；用户自行关闭后恢复本机验证。项目脚本不改系统安全策略，不添加排除规则。

保留 SAC 的场景可参考[已归档的独立开发环境备选方案](archive/windows-native-validation-vm.md)，它没有在本机实施。无论采用哪种环境，解除阻碍后必须重新构建，并在最新 EXE 上执行原生 E2E；旧 EXE 和浏览器替代测试不能作为新版本原生通过的证据。

源码 CI 与各层命令、环境要求统一见[测试分层](testing.md)。仓库根执行 `node scripts/check-docs.cjs` 检查相对文档链接；存储维护测试只操作生成素材和隔离数据。
