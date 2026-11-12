# 桌面开发与发布

阅读 [AGENTS.md](../AGENTS.md)、[开发指南](../docs/development.md)、[前端架构](../docs/architecture/frontend.md)及[通信协议](../docs/architecture/protocol.md)。

桌面使用与 CLI/MCP/HTTP 相同的[公共作业接口 /3](../docs/architecture/application.md)，需配套新 EXE 与核心。旧 start/poll 与临时作业 ID 不再支持；所有入口的 jobId 可在授权范围内跨入口及重启查询。

## 源码发布范围

GitHub 私有仓库使用 MIT，仅包含项目源码和许可记录；没有第三方 EXE/DLL 或完整便携包。依赖缺失时界面提供官方渠道、安装位置、许可说明和刷新按钮。对外二进制发布见[分发核对](../docs/distribution.md)。

LAME/Sharp 可从“工具”页获取、安装与更新至项目核验版本；下载通过 TLS、摘要、归档和加载校验。受管理副本位于核心 `data/dependencies/`，移动本地目录时需一同携带；不能将用户下载文件直接放入对外分发包。

## 开发

Windows x64，Node/npm、Rust MSVC、C++ Build Tools/Windows SDK、WebView2 版本以仓库配置及项目状态为准。从仓库根目录：

```powershell
cd resource-core
npm ci
cd ../desktop
npm ci
npm run dev
```

`npm run dev:web` 仅用于界面调试：普通浏览器没有原生文件调用，开发模式会自动改用模拟核心（样例数据、模拟作业，不读写文件），用法见[前端设计规范](../docs/design/frontend-design.md#在浏览器中调试界面)。完整流程必须运行 Tauri；源码克隆首次运行前须准备 `runtime/node.exe`，或先构建生成便携布局。

## 源码与构建

`src/App.vue` 是窗口外壳（自绘标题栏、活动栏、状态栏）；`src/core/workbench.ts` 集中状态与作业生命周期；`src/views/` 是处理、任务、恢复、工具、作业五个工作区；`src/components/` 包括标题栏、图标、处理线、步骤编辑、参数字段、作业栏和恢复表；`src/styles/tokens.css` 是浅色与深色两套设计令牌。结构见[前端架构](../docs/architecture/frontend.md)。Rust 宿主位于 `src-tauri/src/main.rs`，核心位于相邻 `resource-core/`。

`npm run build` 执行 TypeScript 检查、Vite 打包、Rust release 构建，并通过 `scripts/portable.mjs` 复制根目录 EXE；运行时缺失才复制当前 Node。脚本使用便携 Node 检查 Sharp 原生依赖，失败时不会发布新根 EXE。它不安装依赖，也不自动生成独立分发压缩包。

便携布局：`AssetToolbox.exe` + `runtime/` + 完整 `resource-core/`。手动安装的 Sharp 需携带核心 node_modules；自动安装的 Sharp 使用 `data/dependencies/sharp/` 的完整副本。桌面 node_modules、target、dist、测试产物无需携带。核心依赖应在目标 Windows x64 平台安装，不可把其他系统的原生包直接拷入。首次分发不包含个人 data 或未经放行的依赖；已使用的本地便携目录则保留其新格式 data。

## 验证

桌面目录执行 `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e`；核心目录另执行 `npm test`。原生测试复制完整便携核心，生成样本，通过 `ASSET_TOOLBOX_TEST_PORT` 打开仅本机 CDP，使用独立 WebView2 数据目录，不需要下载 Playwright Chromium。

E2E 包含动态提供方、中文路径、步骤排序/删除与真实透明图片缩放、另存、取消、续跑、重试、选择性恢复、重启和运行中关闭。截图在 `test-results/`。必须先构建当前源码，不用旧 EXE 的结果替代验收。实际结果见[项目状态](../docs/project-status.md)。

E2E 还会移走隔离副本的 LAME/Sharp，从前端真实下载并安装，再验证更新和旧目录保留。需能访问 RareWares 与 npm registry；网络或摘要失败应如实报告，不跳过或放宽校验。

音频分析、增益与响度归一化通过现有处理线接入，作业栏显示测量与限制结果。运行音频核心/原生测试前，按工具页安装 FFmpeg/FFprobe 9.0.2；`tests/audio.spec.ts` 使用生成素材和隔离工具副本，不操作用户资源。详见[音频专题](../docs/architecture/audio.md)。

普通 `npm run test:e2e` 运行 native/audio 项目，禁止下载安装；`npm run test:e2e:network` 独立验证真实 LAME/Sharp 获取、更新和处理，需要网络。核心可用 `npm run test:source` 验证无第三方 EXE 的源码层，完整矩阵见[测试分层](../docs/testing.md)。工具页新增默认保留 30 天的手动存储预览/勾选清理，规则见[存储维护](../docs/architecture/storage.md)。
