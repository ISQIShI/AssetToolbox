# 开发与部署

[返回用户文档](README.md) · 本页面向从源码运行和部署的人；贡献规范、测试细节见[开发与验证](../docs/development.md)。以下命令均在项目根目录的 PowerShell 执行，失败时先解决错误再继续。

## 环境要求

当前完整验收平台为 Windows x64。开发 Node 版本以 [`.nvmrc`](../.nvmrc) 为准，MCP 至少需要 Node 24；建议所有入口使用锁定开发版本。确认 `node --version` 和 `npm --version`，终端中的版本管理器占位命令不代表已安装成功。

构建桌面还需要：

- [Rust/rustup](https://rust-lang.org/tools/install/)，MSVC host；仓库的 [rust-toolchain.toml](../rust-toolchain.toml) 固定工具链及目标。
- Visual Studio C++ Build Tools 与 Windows SDK，在 Installer 导入 [`.vsconfig`](../.vsconfig)。安装入口见 [Tauri 前置要求](https://v2.tauri.app/start/prerequisites/)。
- Microsoft Edge WebView2 Runtime，用于显示桌面界面。

安装后重新打开终端，运行 `cargo --version` 确认。只用 CLI/MCP/HTTP 无需 Rust、MSVC 和 WebView2；但单独从源码编译 pngquant 时仍需其工具链。

## 构建和启动桌面

```powershell
npm ci --prefix resource-core
npm ci --prefix desktop
# 如需 MCP，再安装独立包：
npm ci --prefix agent-mcp --ignore-scripts
npm run build --prefix desktop
.\AssetToolbox.exe
```

构建先做类型检查及前端生产构建，再编译 Tauri，生成根目录 EXE；首次自动复制当前 Node 到 `runtime/node.exe`，并检查 Sharp 能否加载。已有运行时不会自动升级。构建不生成安装包，也不自动安装 pngquant、JPG-C、LAME 或 FFmpeg，按[处理工具指南](dependencies.md)准备所需依赖。

原生开发使用 `npm run dev --prefix desktop`。首次尚未构建时，应先按上面命令构建，或将已安装的 Node 可执行文件复制到 `runtime/node.exe`。`npm run dev:web --prefix desktop` 只用模拟核心预览 UI，不能替代真实处理验收。

## 只部署 Agent 或脚本入口

```powershell
npm ci --prefix resource-core
# 仅使用 MCP 时需要；仅 HTTP API/CLI 可省略：
npm ci --prefix agent-mcp --ignore-scripts
node resource-core/cli.js --help
```

使用系统 Node 即可，无需生成 `runtime/` 或 EXE。按 [MCP 配置](mcp.md)准备 policy，并用 Node 的绝对路径配置宿主；HTTP 服务按 [HTTP API](http-api.md)显式启动。保留核心目录布局，MCP 包含 package.json 和 node_modules；不要只复制 `server.mjs`。

服务只支持本机回环访问。桌面启动的服务跟随桌面退出，CLI 启动的服务由该前台进程持有；当前没有 Windows 后台服务、开机自启或远程部署方案。

## 测试

```powershell
npm run test:source --prefix resource-core
npm test --prefix agent-mcp
npm test --prefix desktop
npm run build:web --prefix desktop
node scripts/version.mjs --check
node scripts/check-docs.cjs
```

只验证源码时不要求外部 EXE。完整功能验收还需安装全部本地提供方，然后运行 `npm test --prefix resource-core`，重新 `npm run build --prefix desktop`，最后 `npm run test:e2e --prefix desktop`。原生测试使用系统 WebView2，生成隔离素材，不要求下载 Playwright 浏览器；联网安装验收另用 `npm run test:e2e:network --prefix desktop`。

GitHub 源码 CI 和源码 Release 无需手动设置仓库 Secrets/Variables：发布使用自动生成、按 job 限权的 `GITHUB_TOKEN`，标签和提交信息来自 GitHub 上下文。步骤自身的 `env:` 与仓库设置页是两回事，解释见[发布流程](../docs/releasing.md#为什么无需手动配置-secret-或环境变量)。

## 移动、更新与分发

本机移动构建结果时，EXE、完整 `runtime/`、`resource-core/` 必须相邻；需要 MCP 时还携带完整 `agent-mcp/`。保留处理工具及其许可证、核心 node_modules、受管理依赖目录。文件夹应由当前用户可写，避免在只读目录运行。

升级前关闭旧桌面和 Agent 服务，保留素材及任务/备份。阅读目标版本的兼容性说明，再成套更新代码、锁定依赖与 EXE；不要混用不同版本的桌面、核心和 MCP，也不要对有本地改动的目录直接覆盖。更新运行时须同时核对 Node 的许可材料。

运行数据位于 `resource-core/data/`，包含配置、任务、报告、依赖和服务令牌。它不属于源码，勿提交或公开。旧契约数据不会自动迁移，备份可通过独立备份导出，详见[使用指南](usage.md)。

本地构建成功不代表可以分发完整便携包。当前公开发行只包含项目源码；第三方依赖仍需按[分发核对](../docs/distribution.md)逐项完成再分发条件。版本维护及标签发布见[发布流程](../docs/releasing.md)。
