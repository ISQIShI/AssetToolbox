# 项目状态

核验日期：2026-11-08（America/Los_Angeles）。本轮基于 `eda40ba`，完成三层扩展契约、图片缩放及全部既有能力迁入。应用版本为 1.0.0，使用全新数据契约；主分支 `main`，无远程仓库。后续交接按[文档管理规范](documentation.md)更新。

## 本轮完成

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
- 便携分发须携带核心 node_modules。构建脚本不生成独立分发压缩包，现有三个编码器的完整来源/许可记录仍需补齐。
- 没有 CI、lint、覆盖率门槛、日志自动清理或全局素材锁。文件安全是单文件保证，不是整批事务。

后续功能按扩展契约添加操作与提供方，先补真实输出和失败保护测试；出现共享服务或生命周期管理需求时，再单独评估 Cordis，当前不预装。
