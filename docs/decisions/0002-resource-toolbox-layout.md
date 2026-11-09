# 0002 资源工具箱职责与目录命名

状态：已采用（目录与命名调整）；插件内核替换仍处于评估阶段。

日期：2026-11-08

关联：[总体架构](../architecture/overview.md)、[职责与 Cordis 评估](../plans/resource-processing-and-cordis.md)。延续 [ADR 0001](0001-local-process-architecture.md) 的进程与文件安全边界。

## 背景与决定

产品职责从压缩扩展为各种资源（重点为游戏资源）的处理，包括未来的图片/音频调整。采用 AssetToolbox / 资源工具箱名称，先消除目录与公共机制对压缩的命名绑定。

| 旧位置或名称 | 新位置或名称 |
| --- | --- |
| `resCompress/` | `resource-core/` |
| `resCompress/compressors/` | `resource-core/processors/` |
| `compressors/index.js` | `framework/registry.js` |
| `compressors/schema.js`、`compressors/process.js` | `framework/schema.js`、`framework/process.js` |
| `options.js` | `framework/options.js` |
| `discoverCompressors`、`adapters`/`adapter` | `discoverProcessors`、`processors`/`processor` |
| `ResourceCompressor.exe` | `AssetToolbox.exe` |
| Rust 包 `resource-compressor` | `asset-toolbox`，产物 `asset-toolbox.exe` |
| 桌面 npm 包 `resource-compressor-desktop` | `asset-toolbox-desktop` |
| `RESOURCE_COMPRESSOR_TEST_PORT` | `ASSET_TOOLBOX_TEST_PORT`，宿主保留旧变量回退 |

通用机制与具体处理器分开，避免公共文件混在自动发现目录。根层保留已有明确职责的入口，不为尚不存在的业务建立空框架。压缩专用的 `compress.js`、`compressFolder()`、模块 `compress()`/`shouldCompress()`、mode 和日志状态继续使用压缩语义。

Tauri `identifier` 保留 `local.resource-compressor.desktop`，维持既有应用身份与 WebView 数据路径；展示名称和产物已更新。已有模块 ID、配置字段、任务/报告格式不变。CLI 入口路径与内部 require 路径有破坏性变化，应在提交中明确说明。

## 升级与回退

当前工作副本已完成以下目录迁移。其他旧部署升级时：

1. 关闭旧 EXE，等待作业安全结束；备份整个便携目录。源素材和外部备份不移动。
2. 确认目标 `resource-core/` 不存在，再将整个 `resCompress/` 改名为 `resource-core/`；确认目标 `processors/` 不存在，再将其中 `compressors/` 改名为 `processors/`。两套目录已共存时停止自动操作，先核对各自数据，禁止覆盖合并。
3. 用新版源码更新核心，公共文件按上表迁移至 `framework/`，不要保留过时的同名入口。保留 `user-settings.json`、`config/`、每个处理器的 `user-settings.json`、`tasks/` 和 `reports/` 的原始字节。
4. 自定义模块保留目录 ID 与参数名；若引用旧 `require('../process')`，更新为 `require('../../framework/process')`。同步内部注册表、schema 和 options 引用。旧格式压缩模块的 `compress()` 接口继续有效。
5. 构建新版 `AssetToolbox.exe`，保留 `runtime/`，更新快捷方式、CLI 脚本及外部 require。旧 EXE 只能配旧布局运行，应归档到备份中。
6. 从界面任务历史或 `node resource-core/tasks.js --list` 取得新 `taskFile` 路径。旧报告中的绝对 `taskFile` 是历史记录，不批量改写，也不能再直接用作入口；源、输出、备份的绝对路径仍须保持可访问。

回退时关闭新程序并恢复完整旧版本目录备份，使用与旧布局匹配的 EXE。新版本已产生用户数据时先另行备份，不用源码回退覆盖这些数据。升级不进行隐式数据迁移、自动扫描旧目录或修改素材。

## 取舍与验证

目录重组降低后续扩展的命名阻力，保持压缩与恢复行为；它尚未解除扩展名独占或只接受更小输出的业务限制。完整换框架会同时影响进程生命周期、便携打包和历史任务，另行评估。

验证包含核心回归、旧 v2 配置/v1 任务字节保留及续跑、组件测试、类型检查、新 EXE release 构建与原生 E2E；实际结果见[项目状态](../project-status.md)。本地用户文件逐一比较 SHA-256，迁移日志与备份保存在忽略的 `.local/refactor/`。
