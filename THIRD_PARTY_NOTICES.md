# 第三方来源与许可声明

AssetToolbox 自有源码按根目录 [MIT License](LICENSE) 发布。MIT 不替换或重新许可第三方工具、依赖、源码及许可证文本。当前 GitHub 仓库仅发布项目源码、锁文件、来源记录和许可说明，不携带 EXE、DLL、Node 运行时或 node_modules；私有可见性本身不免除第三方义务。

音频提供方核验日期：2026-11-10；其余工具记录沿用 2026-11-08/09 的核验。可安装渠道同步记录于每个提供方的 `provenance.json`，前端“工具”页读取这些记录。

| 提供方 | 当前本地版本 / 来源 | 许可与本次处置 |
| --- | --- | --- |
| FFmpeg / FFprobe | 9.0.2-essentials_build-www.gyan.dev；[官网 Windows 渠道](https://ffmpeg.org/download.html)、[Gyan 构建页](https://www.gyan.dev/ffmpeg/builds/)、[对应源提交](https://github.com/FFmpeg/FFmpeg/commit/946fcce07b) | FFmpeg developers 及所含组件作者；本构建启用 GPL/version3，适用 GPL-3.0-or-later，并非 LGPL-only。[本地包 GPL 文本](third-party/licenses/ffmpeg-9.0.2-GPL.txt)。从已有本地安装复制两个工具，记录版本、配置及文件 SHA-256；未重新下载或核验发行归档，完整对应源码和组件许可待补齐，不分发二进制。 |
| pngquant | 3.0.3；[作者项目](https://github.com/kornelski/pngquant/tree/3.0.3)、[crates.io 发行包](https://crates.io/crates/pngquant/3.0.3) | Kornel Lesiński 及 Jef Poskanzer、Greg Roelofs 等贡献者；GPL-3.0-or-later，附原始代码声明；另有商业许可。由官方发行源码锁定依赖编译，替换本地 2.17.0；[完整 COPYRIGHT](third-party/licenses/pngquant-3.0.3-COPYRIGHT.txt)。 |
| JPG-C | 4.0.21.902；EXE 版本信息为 Copyright (C) zzy 2021 / zzy.my；[作者页面](https://zzy.my/blog/post/Jpg-C) | 原始二进制取得渠道无可核验证据；未找到明确再分发许可。作者页面本轮超时/证书异常，未绕过证书检查；保留本地版本，不分发。 |
| LAME | 4.0 x64；[官方项目](https://lame.sourceforge.io/)、[官网推荐的 RareWares](https://www.rarewares.org/mp3-lame-bundle.php)，2026-08-23 未打 q4 补丁构建 | LAME Project；可执行文件自述 GNU Library GPL v2 or later。更新本地 3.100.1，同时安装 libmpg123-0.dll。二进制与对应源码、解码组件的许可链尚未闭合，故不分发。不能仅凭 LGPL 标签忽略解码器。 |
| Sharp | 0.35.5，npm 锁文件；[源代码](https://github.com/lovell/sharp/tree/v0.35.5) | Copyright 2013 Lovell Fuller and others，Apache-2.0；已为当前稳定版本，未无目的升级。[许可证](third-party/licenses/sharp-0.35.5-LICENSE.txt)。 |
| Sharp Windows 原生包 | @img/sharp-win32-x64 0.35.5，libvips 8.18.7 | 包元数据标记 Apache-2.0 AND LGPL-3.0-or-later；还包含多项第三方许可，见[原包附带的 LICENSE](third-party/licenses/sharp-win32-x64-0.35.5-LICENSE.txt)及[组件版本表](third-party/sharp-win32-x64-versions.json)。附带 LICENSE 当前只有 Apache 文本，不能替代元数据中的 LGPL 及各组件声明；这些材料尚需补齐。不能将整个包标为 Apache 或 MIT。 |

pngquant 主页宣告当前稳定版本 3.0.3，但本轮下载的官方 `pngquant-windows.zip` 内实际仍是 2.17.0，因此没有把旧 ZIP 冒充更新。更新通过 `cargo install pngquant --version 3.0.3 --locked` 完成；Rust 1.99.1 / Windows x64 MSVC，未改上游源码。对应 Cargo.lock、源码和 crate 校验和见[本地构建记录](third-party/provider-artifacts.json)。

LAME 官方只提供源码，Windows 包来自其 Links 页面指向的第三方构建者。[官方许可说明](https://lame.sourceforge.io/license.txt)还保留对旧 mpglib GPL 解码代码的提醒；当前包改用独立 DLL，仍需核对实际源码/链接方式。获取“官方推荐构建”与确认“完整分发条件已满足”是两件事。本次不作二进制分发承诺。

本仓库没有重新发布第三方实现源码，保存许可证文本仅用于署名与审计。Node 运行时另见 [Node 许可合集](runtime/LICENSE-node.txt)。界面使用操作系统自带的字体，前端产物不打包任何字体文件。下拉选择与提示的交互行为来自 Reka UI 2.11.0（MIT，npm 包 `reka-ui`，<https://reka-ui.com/>），连同其传递依赖一起打包进前端产物：`@floating-ui/*`、`@vueuse/*`、`@tanstack/vue-virtual`、`aria-hidden`、`defu`、`ohash`（MIT），`@internationalized/date`、`@internationalized/number`、`@swc/helpers`（Apache-2.0），`tslib`（0BSD）。版本以 `desktop/package-lock.json` 为准，随 EXE 分发时须保留各包的许可声明，Apache-2.0 的包还须附带许可证文本与 NOTICE（如有）。Vue、Tauri、Vite、Rust crate 等依赖各自按其锁定包的许可证使用；发布编译后的应用前还需生成所含依赖的完整声明，见[分发核对流程](docs/distribution.md)。

项目源码仍保留提供方适配代码；缺少第三方工具时可按前端说明自行获取，或禁用相关步骤。2026-11-09 起支持用户主动触发 LAME/Sharp 固定核验版本的自动下载，地址与摘要见 `resource-core/framework/dependencies/catalog.json`；LAME ZIP 已重新取样匹配原 SHA-256，Sharp 五个 npm 包按锁文件 SHA-512 验证。保留原包许可证，不静默接受商业条款，不使用来源不明的镜像。

自动下载只从原渠道安装到用户本地，不向 GitHub 上传安装产物；既有完整便携包分发缺口仍未闭合。流程与限制见[依赖管理](docs/architecture/dependencies.md)。

## Agent 接入依赖（2026-11-10）

独立 `agent-mcp/` 包从 npm 官方 registry 安装，版本、精确 tarball URL 和 SHA-512 完整记录于 [package-lock.json](agent-mcp/package-lock.json)。没有运行 npm 生命周期脚本；核心和桌面的依赖不随之增加。

| 包 | 来源与版本 | 许可记录 |
| --- | --- | --- |
| @modelcontextprotocol/server、core；client 仅测试 | 官方 [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)，2.4.0 | 包元数据为 Apache-2.0；[包内完整 LICENSE](third-party/licenses/mcp-sdk-2.4.0-LICENSE.txt)同时说明许可过渡：未取得重新授权的原有贡献仍按 MIT，新贡献 Apache-2.0。保留原声明及两种文本，不将全部代码改标为 MIT；三个包的 LICENSE 摘要一致。 |
| Zod | [官方仓库](https://github.com/colinhacks/zod)，4.6.7 | MIT，保留[原许可证](third-party/licenses/zod-4.6.7-LICENSE.txt)。 |

这次只提交自有适配代码、锁文件及许可文本，不发布第三方包产物。未来分发 MCP 的 node_modules 或打包代码时须带上实际依赖闭包的全部声明；测试客户端及其传递依赖不应混入生产部署。源码仍为 MIT，当前便携二进制分发限制保持不变。

HTTP 扩展增加官方 `@modelcontextprotocol/node` 2.1.2，其 peer 要求 server ^2.4.0，保留现有 server/client 2.4.0；包内 LICENSE 与上述 SDK 文本 SHA-256 一致，仍适用 Apache/MIT 过渡说明。传递依赖 Hono 4.13.17、@hono/node-server 2.1.6 均为 MIT，保留 [Hono 原许可证](third-party/licenses/hono-4.13.17-LICENSE.txt)及 [Node 适配器原许可证](third-party/licenses/hono-node-server-2.1.6-LICENSE.txt)。官方来源为 [Hono](https://github.com/honojs/hono)与 [node-server](https://github.com/honojs/node-server)，精确 npm URL/摘要见同一锁文件。只运行 HTTP API 的核心入口无需这些 npm 包。
