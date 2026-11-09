# 桌面开发与发布

阅读 [AGENTS.md](../AGENTS.md)、[开发指南](../docs/development.md)、[前端架构](../docs/architecture/frontend.md)及[通信协议](../docs/architecture/protocol.md)。

## 源码发布范围

GitHub 私有仓库使用 MIT，仅包含项目源码和许可记录；没有第三方 EXE/DLL 或完整便携包。依赖缺失时界面提供官方渠道、安装位置、许可说明和刷新按钮。对外二进制发布见[分发核对](../docs/distribution.md)。

## 开发

Windows x64，Node/npm、Rust MSVC、C++ Build Tools/Windows SDK、WebView2 版本以仓库配置及项目状态为准。从仓库根目录：

```powershell
cd resource-core
npm ci
cd ../desktop
npm ci
npm run dev
```

`npm run dev:web` 仅用于样式调试，普通浏览器没有原生文件调用。完整流程必须运行 Tauri；源码克隆首次运行前须准备 `runtime/node.exe`，或先构建生成便携布局。

## 源码与构建

`src/App.vue` 管理三个工作区及作业；`StepEditor.vue` 和 `ParameterFields.vue` 根据扩展目录编辑 pipeline；`RestoreTable.vue` 管理恢复勾选。Rust 宿主位于 `src-tauri/src/main.rs`，核心位于相邻 `resource-core/`。

`npm run build` 执行 TypeScript 检查、Vite 打包、Rust release 构建，并通过 `scripts/portable.mjs` 复制根目录 EXE；运行时缺失才复制当前 Node。脚本使用便携 Node 检查 Sharp 原生依赖，失败时不会发布新根 EXE。它不安装依赖，也不自动生成独立分发压缩包。

便携布局：`AssetToolbox.exe` + `runtime/` + 完整 `resource-core/`，其中核心 **node_modules 必须携带**；桌面 node_modules、target、dist、测试产物无需分发。核心依赖应在目标 Windows x64 平台安装，不可把其他系统的原生包直接拷入。首次分发不包含个人 data，已使用的便携目录则保留其新格式 data。

## 验证

桌面目录执行 `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e`；核心目录另执行 `npm test`。原生测试复制完整便携核心，生成样本，通过 `ASSET_TOOLBOX_TEST_PORT` 打开仅本机 CDP，使用独立 WebView2 数据目录，不需要下载 Playwright Chromium。

E2E 包含动态提供方、中文路径、步骤排序/删除与真实透明图片缩放、另存、取消、续跑、重试、选择性恢复、重启和运行中关闭。截图在 `test-results/`。必须先构建当前源码，不用旧 EXE 的结果替代验收。实际结果见[项目状态](../docs/project-status.md)。
