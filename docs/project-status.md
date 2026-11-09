# 项目状态

核验日期：2026-11-09（America/Los_Angeles）。当前版本 1.0.0。本轮按用户要求全面重构前端设计，不保留旧界面兼容；协议、配置、任务和报告格式不变。上一轮完成了提供方来源/许可核对与 GitHub 私有 MIT 源码发布。仓库：[ISQIShI/AssetToolbox](https://github.com/ISQIShI/AssetToolbox)，main 跟踪 origin/main。

## 前端重构（本轮）

- 处理页改为“处理线”主从结构：左侧按执行顺序列出来源、步骤、写入和扫描结果，右侧编辑选中项。添加步骤改为从目录组合菜单选择，“恢复默认参数”改为只作用于当前步骤。
- 顶栏分为处理、任务、恢复、工具四个工作区。处理工具清单移到“工具”页，缺依赖数量显示在标签上，并用“丢失贴图”品红棋盘格标记。
- 作业改为窗口底部的全局作业栏，任何页面都能看到进度和取消；预览类作业拿到结果后自动收起，结果归入所属页面。恢复页可直接选择有备份的任务。
- 状态与作业动作集中到 `desktop/src/core/workbench.ts`；源码按 `core/`、`views/`、`components/`、`styles/` 重组。新增设计令牌、IBM Plex 字体（OFL-1.1，@fontsource 5.3.0）及开发模式浏览器模拟核心。
- 修复：初始化时对响应式代理调用 `structuredClone` 会抛错，改为先复制原始响应。
- 新增[前端设计规范](design/frontend-design.md)与 [ADR 0004](decisions/0004-frontend-redesign.md)，重写[前端架构](architecture/frontend.md)，同步用户说明、桌面 README、开发指南、第三方声明与 AGENTS。

### 本轮验证

| 检查 | 结果 |
| --- | --- |
| 类型检查 | `desktop/` 中 `npm run typecheck` 通过 |
| 组件与应用测试 | `desktop/` 中 `npm test`：2 文件、18 项通过 |
| 发布构建 | `npm run build` 通过，Rust release 约 1 分 31 秒，便携 Sharp 加载检查通过 |
| 原生 E2E | 用最终源码构建的新 EXE 运行 `npm run test:e2e`：1 项综合用例通过，约 28.5 秒；选择器全部改为新结构，文件安全断言未改动 |
| 依赖审计 | 新增字体包后 `npm audit` 0 项漏洞 |
| 对比度 | 状态色在 paper/canvas/paper-sunk/focus-wash 上均不低于 4.5:1（脚本计算） |
| 界面核对 | 浏览器模拟核心下检查 1220×850、1100×760、840×620 的处理、扫描、作业栏、任务、恢复、工具页；原生截图位于 `desktop/test-results/` |
| 文档链接 | 24 篇 Markdown，0 个失效相对链接 |
| 核心测试 | 未执行：本轮未修改 `resource-core/` |

EXE 为 9,167,360 字节，SHA-256 abd9c8541f91ffee329520815302d50b8cb888292a44f99f8ded1fedbe8e2479；仅本地，不提交。

### 已知限制

- 未提供深色模式和拖拽排序。
- 浏览器模拟核心只用于看效果，不代表真实行为；行为以组件测试和原生 E2E 为准。
- 作业结束后作业栏需要手动关闭；预览类作业除外。

## 来源、更新与发布（上一轮）

- 自有源码采用 MIT；新增第三方声明、提供方 provenance.json、原包许可证文本、SHA-256 和构建记录，详见[第三方声明](../THIRD_PARTY_NOTICES.md)及[分发核对](distribution.md)。
- pngquant 从 2.17.0 升至 3.0.3：官网 Windows ZIP 实际仍为旧版，采用官方 crates.io 锁定源码本地编译。LAME 从 3.100.1 升至 RareWares 4.0 x64，包含 libmpg123-0.dll；两个提供方版本升至 2.0.0。
- Sharp 0.35.5 为当前稳定版，保留；JPG-C 4.0.21.902 的作者页面证书/访问异常且未找到再分发许可，保留本地版本，不发布二进制。
- 前端新增全部提供方清单；缺失项展开显示原因、官方获取页面、安装位置、核验版本和许可说明。刷新不丢失当前配置；缺依赖的启用步骤阻止开始，禁用后可使用其他功能。获取链接通过提供方 ID 在核心解析，原生只打开 HTTPS。
- 用户确认 GitHub 仅发布源码，EXE/DLL 留本地；取消跟踪三个编码器，并在隔离 Git 副本清理历史二进制。完整便携包尚未放行，不能把本地 EXE 当成已完成许可核验的发行包。

### 上一轮验证

| 检查 | 结果 |
| --- | --- |
| 核心测试（便携 Node 24.19.0） | 89 通过、0 失败、0 跳过，约 41.6 秒；使用更新后的真实编码器 |
| 前端组件 | 2 文件、9 项通过；覆盖缺失渠道、安装说明、刷新及按 ID 打开渠道 |
| 类型检查 | npm run typecheck 通过 |
| 发布构建 | npm run build 通过，Vite 28 模块，Rust release 约 1 分 38 秒 |
| 原生 E2E | 等待构建结束后以新 EXE 重跑，1 项综合用例通过，约 22.9 秒；覆盖工具移走/恢复与渠道显示及原有完整流程 |
| 文档链接 | 22 篇文档，0 个失效相对文件链接 |
| EXE | 8,992,768 字节，SHA-256 08c810d0298d320d57c42e5be1ea91c11d7580ce4636ff0618295b172a0656e0；仅本地 |

首轮 E2E 与构建时序重叠，复制到旧 EXE 后因缺少新控件超时；该结果不作为验收，后续已使用完成构建的新 EXE 通过。日志位于 .local/release-review，旧编码器备份于其中 previous-binaries；未操作真实素材。JPG-C 原文件哈希未变。

### 已知发布限制

JPG-C 再分发授权、LAME 实际构建对应源码及解码库许可、Sharp Windows 原生包完整 LGPL/组件材料尚未闭合。现有 npm 包 LICENSE 只包含 Apache 文本，不能据此忽略其元数据中的 LGPL。源码范围可发布；check-release 的 --portable 模式会明确拒绝完整二进制放行。

以下为上一轮契约实现的验证记录，保留作历史基线；当前版本与结果以上表为准。

## 契约实现（历史基线）

- 实现“资源类型—处理操作—实现提供方”，分别自动发现于 resource-types、operations、providers；资源扩展名唯一，提供方可共享同一类型/操作组合。
- 实现最多 64 步的有序 pipeline，重复操作参数隔离，三层版本与参数快照；桌面动态选择、启用、添加、排序、删除及重置参数。
- PNG/pngquant、JPG/jpg-c、MP3/lame 压缩全部迁入。新增 PNG/JPEG 的 Sharp 0.35.5 缩放，支持三种尺寸适应方式、两种插值、仅缩小/允许放大、透明通道、方向纠正；拒绝动画/多页与损坏图片。
- 压缩使用 smaller-only，缩放使用 valid-output；单文件全部步骤成功后一次提交，失败不写中间产物。逐步结果写入任务和报告，体积变化支持负值。
- 保留并迁入另存、覆盖备份、只读预览、取消、固定清单、续跑、失败重试、锁、崩溃判定、选择性恢复及独立备份导出；恢复不依赖转换插件。
- 新配置、任务、报告分别采用 `asset-toolbox.settings/1`、`asset-toolbox.task/1`、`asset-toolbox.report/1`，写入核心 data。删除旧配置聚合、旧模块和压缩 CLI 接口，无旧格式兼容或迁移逻辑。
- 暂不接入 Cordis。重写用户指南、架构/协议/持久化/前端/后端文档，新增[扩展契约](architecture/extensions.md)及 [ADR 0003](decisions/0003-processing-contract.md)，更新 AGENTS 和历史决策状态。

## 实际验证

| 检查 | 最终结果 |
| --- | --- |
| 核心依赖 | `resource-core/` 中 `npm ci --no-fund` 通过，锁文件安装 5 个包；Sharp 0.35.5 |
| 依赖审计 | 核心和桌面分别 `npm audit --json`，均 0 项漏洞 |
| 开发 Node 核心回归 | Node 26.13.0：87 通过、0 失败、0 跳过；随后增加动画拒绝用例，由下行便携运行时全量验收 |
| 最终核心回归 | 根目录 `.\runtime\node.exe --test resource-core/tests/*.test.js`：Node 24.19.0，88 通过、0 失败、0 跳过，约 39.3 秒 |
| 组件测试 | `desktop/` 中 `npm test`：2 文件、8 项通过 |
| 类型检查 | `npm run typecheck` 通过，包含前端、测试及配置 |
| 前端与原生构建 | `npm run build` 通过，Vite 26 模块，Rust release 约 1 分 40 秒；便携 Node 加载 Sharp 检查通过 |
| 原生 E2E | 新 EXE + 完整核心依赖：1 项综合流程通过；包括实际透明 PNG 缩放及原有全流程 |
| 文档 | 20 篇文档相对文件链接检查，无失效链接；当前协议和目录按源码核对 |
| 数据与工具 | 14 个旧用户数据文件归档后 SHA-256 全部一致；三个编码器与 Git 基线逐字节一致 |

测试使用生成素材、系统临时隔离目录和独立 WebView2 数据目录，不访问真实素材。新 `resource-core/data/` 尚未创建。旧用户数据归档到 `.local/contract/previous-data/`，迁移前 EXE 为 `.local/contract/AssetToolbox-before-contract.exe`；这些是人工回退资料，应用不会读取。详细验证日志在 `.local/contract/`，不提交。

根 EXE 为 8,973,824 字节，与 release 产物 SHA-256 相同：`d9ff52043a818562cf283c9b17dd436dce11d4bbc39e89f12134e7e4ebe2068c`。7 张 E2E 截图位于 `desktop/test-results/`，已查看缩放表单与 840px 紧凑布局，无横向溢出。

## 环境与本轮修复

环境延续 Node 26.13.0/npm 11.20.0、便携 Node 24.19.0、Rust/Cargo 1.99.1、VS Build Tools 2022 17.14.44、MSVC v143 14.44、Windows SDK 26100、WebView2 157.0.4341.42。配置由 `.nvmrc`、`rust-toolchain.toml`、`.vsconfig` 记录。

Sharp 原生库如果在父进程加载，会在 Windows 保持 DLL 文件锁；依赖探测和转换改用短生命周期子进程。半透明 RGB 经 libvips 预乘会产生一个色阶舍入，测试验证该容差且 alpha 精确保持。PNG 显式检查动画控制块，防止静态解码忽略动画。

沙箱中的原子 rename 测试仍会触发 EPERM；正常用户环境下全套通过。未修改安全断言来适配沙箱。原格式兼容测试已替换为新契约拒绝/快照测试，测试总数与旧项目不可直接比较。

## 仍有的边界与后续方向

- 目前同格式、一入一出、逐文件串行，扩展为可信本地代码；无热重载、依赖注入或权限沙箱。版本匹配依赖开发者正确升级版本，不是代码哈希校验。
- 工具执行无强制超时，取消在文件边界生效；Sharp 每文件启动子进程有开销。大任务内存和日志重放尚未做性能基准。
- 缩放首版仅静态 PNG/JPEG，最大 4000 万像素；音频调整、格式转换、多输出仍待需求实现。
- 便携分发须携带核心 node_modules。构建脚本不生成独立分发压缩包，来源/许可记录已建立，剩余二进制放行条件见上方本轮记录。
- 没有 CI、lint、覆盖率门槛、日志自动清理或全局素材锁。文件安全是单文件保证，不是整批事务。

后续功能按扩展契约添加操作与提供方，先补真实输出和失败保护测试；出现共享服务或生命周期管理需求时，再单独评估 Cordis，当前不预装。

## GitHub 发布结果

已创建并推送 [ISQIShI/AssetToolbox](https://github.com/ISQIShI/AssetToolbox)，GitHub API 核验 private=true、默认分支 main、许可证识别 MIT。远端当前树 108 个文件，无 EXE/DLL/.node、node_modules、.local 或运行 data。

在隔离裸仓库过滤 6 个历史提交中的第三方二进制，确认过滤前后当前源码 tree 完全一致，再更新本地 main。原 Git 历史完整保存在忽略的 `.local/release-review/pre-source-publication.bundle`；当前有效历史的提交 ID 因过滤而变化，前文旧 ID 仅为本地历史基线，不能据此推送归档 refs。已扫描这 6 个提交，未命中 GitHub token 或私钥标记。

`node scripts/check-release.mjs --source` 通过；`--portable` 按预期拒绝，保留真实许可未闭合项。没有创建带二进制的 Release，也没有上传用户数据。三个 EXE 和 LAME 伴随 DLL 仍留在本地供使用，旧编码器保留本地备份。新获取界面的截图已核对。
