# 桌面开发与发布

开发规则见 [AGENTS.md](../AGENTS.md)；架构解析见[前端设计](../docs/architecture/frontend.md)、[后端设计](../docs/architecture/backend.md)和[通信协议](../docs/architecture/protocol.md)。实际环境与验证记录见[项目状态](../docs/project-status.md)。

日常使用：双击工具根目录的 `ResourceCompressor.exe`。前端资源嵌入 EXE；`runtime/node.exe`、`resCompress` 必须与 EXE 一起移动。用户配置、模块配置、任务和报告仍保留原位置。编码器仍由各自模块管理。

## 代码划分

```
desktop/
  src/App.vue               三个工作区、任务进度与退出交互
  src/ModuleCard.vue        根据模块 schema 生成参数表单
  src/RestoreTable.vue      恢复筛选、分页、勾选与快照提交
  src/types.ts / model.ts   通信类型与界面规则
  src/api.ts                Tauri 调用和目录选择
  src-tauri/src/main.rs     Rust 宿主与 stdio 桥接
  tests/                    组件测试、真实 WebView2 流程测试
resCompress/
  desktop-bridge.js         JSON Lines 协议、工作进程生命周期
  batch.js                  复用的后台任务、状态、取消和报告
  compress.js / restore.js  复用的压缩与安全恢复核心
  compressors/              自动发现的模块、配置与编码器
runtime/node.exe             独立 Node.js 运行时
```

## 开发与构建（Windows x64）

开发机器需要 Node.js 22.12+、Rust stable MSVC 工具链、Visual Studio C++ Build Tools 与 Windows SDK、WebView2 Runtime。普通使用者只需随附的运行时和系统 WebView2。

仓库固定的开发版本、`.vsconfig` 导入方式、PATH 刷新及依赖安装许可见[开发环境说明](../docs/development.md)。便携 Node 与开发 Node 分别验证，不因全局版本变化自动替换发布运行时。

```powershell
cd desktop
npm ci
npm run dev
```

`npm run dev` 使用 Vite 与 Tauri 原生窗口，调试时相对开发目录寻找核心。`npm run dev:web` 仅适用于样式开发，浏览器没有原生桥接；完整流程使用 Tauri。

```powershell
npm run build
```

构建先运行 TypeScript 检查、打包前端，再生成 Rust release EXE。`scripts/portable.mjs` 将 EXE 放入工具根目录；缺失 `runtime/node.exe` 时从当前 Node 复制。不复制或覆盖配置、模块、任务、报告和素材。`package-lock.json`、`src-tauri/Cargo.lock` 锁定依赖。发布时不需要携带 `node_modules`、`target`、`dist`、测试产物；保留源码便于后续扩展。

## 验证

```powershell
# 核心：真实图片/音频、配置兼容、断点、恢复安全、桌面通信
cd resCompress
npm test

# 前端：动态字段、选择集、取消预览、保存方式
cd ../desktop
npm test

# 独立类型检查
npm run typecheck

# 原生：必须先 npm run build
npm run test:e2e
```

原生测试在系统临时目录创建独立工具副本，启动真正的 release EXE，通过 WebView2 的官方 CDP 测试接口操作页面。测试进程设置独立的 RESOURCE_COMPRESSOR_TEST_PORT、WebView 用户目录，并隐藏测试窗口；正常启动不启用这些设置。覆盖旧配置载入、新模块自动生成、只读扫描、预览结果的页面隔离、任务结果关闭、另存、跨页面取消、继续、失败重试、冲突保护、选择性恢复及重开设置；截图保存到 `desktop/test-results`。

原 WinForms 界面和基于 PowerShell 控件注入的测试不再维护。删除旧启动脚本、参数注入通道及仅验证 PowerShell 入口的测试，保留 Node CLI 的兼容测试与文件安全测试；不为静态样式和低风险文案维护快照测试。

## 通信契约

Tauri 仅暴露 `core_call(action,payload)` 与 `open_report(id)`。Node 白名单操作为 `bootstrap`、`normalize`、`save`、`tasks`、`start`、`poll`、`cancel`、`report`。每条消息具有请求序号，UTF-8 JSON Lines 通过管道传输，长文本和中文路径不受命令行长度或代码页限制。报告操作只打开当前已完成任务的报告目录。

`start` 使用现有 batch 请求格式，不改写任务磁盘格式；每次任务在自有临时目录写入 request/status/cancel 文件，完成后回收。任务锁释放、工作进程退出后才报告 done，防止紧接着续压与未释放的锁冲突。主窗口关闭会先请求取消并等待当前文件结束；宿主异常退出时，桥接进程也会请求安全停止。强制结束整个进程树仍可能中断编码，后续通过原任务写入意图和哈希校验恢复。

目录选择由 Tauri dialog 插件提供。生产程序没有 HTTP 服务、外部页面、远程脚本或通用 shell API。模块本身仍是可信的本地 Node.js 代码，与此前扩展机制一致。

## 进度和结果的页面归属

运行中的任务卡片全局可见，切页不重置任务、轮询或取消状态。普通压缩与扫描属于“压缩资源”，继续/重试属于“任务历史”，备份预览和恢复属于“备份恢复”；按请求类型确定归属，避免启动过程中切页导致结果放错位置。

预览返回结果后移除临时任务卡片，由扫描结果或恢复列表呈现内容；取消预览保留不完整结果的提示。预览异常且没有结果时仍显示错误卡片。其他完成卡片仅在所属页面显示并支持关闭，关闭不删除持久化数据。`scanFolder` 返回 `checked`，后台使用实际检查数写入最终进度，包括空文件夹及取消情况。
