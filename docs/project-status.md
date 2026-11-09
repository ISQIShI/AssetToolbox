# 项目接手状态

核验日期：2026-11-08（America/Los_Angeles）。本轮基于环境配置提交 `96e478b`，完成资源工具箱职责、命名与目录调整，并评估 Cordis。初始源码/文档基线为 `e05512d` / `a2f2db9`。后续任务结束时按[文档管理规范](documentation.md)维护。

## 已建立的基线

- 本地 Git 默认分支为 `main`；首个提交为 `chore(repo): 初始化本地仓库并纳入项目基线`，未配置远程仓库。
- 项目主要语言为简体中文，新提交使用 Conventional Commits。
- 建立文档索引、管理规范、前端/后端架构、通信协议、持久化契约、开发流程和架构决策记录。
- 用户配置、任务、报告、素材及现有便携运行文件保留在磁盘；用户数据和生成产物不进入源码历史。
- 新增 `.nvmrc`、`rust-toolchain.toml`、`.vsconfig`，固定开发版本与原生组件；新增 `npm run typecheck`。
- 上轮修复开发依赖审计问题并完成锁文件干净安装；本轮依赖版本未改变。
- 产品统一为 AssetToolbox 资源工具箱，职责扩展至游戏等资源的多种处理；当前业务仍为压缩与恢复。
- 核心由 `resCompress/` 迁为 `resource-core/`，模块由 `compressors/` 迁为 `processors/`，公共注册、schema、选项和进程工具集中到 `framework/`。
- 更新内部处理器命名、Rust/npm 包名、窗口品牌、构建和测试路径。压缩方法、协议、模块 ID 与磁盘格式保持原语义。
- 建立[目录迁移决策](decisions/0002-resource-toolbox-layout.md)与[职责/Cordis 评估](plans/resource-processing-and-cordis.md)；尚未安装 Cordis 或实现图片/音频调整操作。

## 当前环境与验证

| 检查 | 结果 |
| --- | --- |
| 本地 Git | 2.56.0.windows.4，main 分支，无远程仓库 |
| 随附 Node | `runtime/node.exe` 为 v24.19.0 |
| 开发 Node/npm | 真实用户环境已安装 Node 26.13.0、npm 11.20.0，nvm 2.0.1 管理；沿用现有默认版本 |
| Rust | rustup 1.29.3、rustc/Cargo 1.99.1，host/target 为 x86_64-pc-windows-msvc；包含 rustfmt 与 Clippy，用户 PATH 已配置 |
| C++ 与 SDK | Build Tools 2022 17.14.44（17.14.37827.9）、MSVC v143（cl 19.44.35229.0，工具目录 14.44.35207）、Windows SDK 10.0.26100.0 |
| WebView2 | 已有 Evergreen Runtime 157.0.4341.42 |
| 前端依赖 | 上轮 `npm ci --no-fund` 通过；本轮只更新包名。Vue 3.5.44、Vite 7.3.7、TypeScript 5.9.3、Vitest 4.1.12、Playwright 1.64.1 |
| 依赖审计 | 上轮 `npm audit --json`：0 项；本轮未新增依赖、未重跑在线审计 |
| 核心回归 | `resource-core/` 中 `npm test`，开发 Node 26.13.0：90 通过、0 失败、0 跳过，约 43.3 秒 |
| 旧布局兼容 | 新增旧 v2 配置/v1 任务迁移回归：读入前后字节一致、历史 taskFile 按新位置生成、旧 plan 可续跑，原素材与旧报告保留 |
| 组件测试 | `desktop/` 中 `npm test`：Vitest 4.1.12，2 个文件、8 项全部通过 |
| 类型检查 | `desktop/` 中 `npm run typecheck` 通过，包含界面、测试和配置 |
| 前端构建 | 最终锁文件下 `npm run build` 内的类型检查与 Vite 7.3.7 打包通过，24 个模块 |
| release 构建 | `desktop/` 中 `npm run build` 通过，Rust release 编译约 1 分 36 秒；已生成并复制新的 `AssetToolbox.exe` |
| 原生 E2E | 使用新 EXE 和便携 Node 24.19.0 执行 `npm run test:e2e`：1 项综合用例通过，约 21.9 秒；覆盖配置、动态模块、另存、取消、续压、重试、选择性恢复、重启和运行中关闭 |
| 用户数据保护 | 按新旧路径映射核对 14 个用户配置、任务及报告文件 SHA-256，0 项变化；三个编码器与 Git 基线逐字节一致 |

验证使用正常 Windows 文件权限，测试仅操作生成样本与隔离副本。本轮日志和用户文件清单保存在 Git 忽略目录 `.local/refactor/`；迁移前数据及旧 EXE 归档在 `.local/refactor/backups/`。上轮环境日志仍在 `.local/validation/`。

根目录 `AssetToolbox.exe` 为 8,972,800 字节，与 `desktop/src-tauri/target/release/asset-toolbox.exe` 的 SHA-256 一致：`ae1b20cb279166eae93fe0bc4394712b5b9cefa6ca59af436d764c9e09c1f86d`。E2E 的 6 张截图保存在 `desktop/test-results/`，已核对紧凑布局中的新品牌、表单与模块区域。生成产物与日志不提交到 Git。

## 环境维护记录（上一轮）

- **环境检测失真**：沙箱重定向 LocalAppData 导致 nvm 误报未激活；普通用户环境实际已有可用 Node/npm。更新环境说明，避免重复安装。沙箱也会阻止测试中的 rename/链接，相关验证在正常权限环境执行。
- **原生工具链缺失**：安装 Rust MSVC 工具链，并安装 C++ Build Tools 与 SDK；固定版本及组件清单，记录新终端刷新 PATH 的方式。
- **开发依赖漏洞**：Vitest 3.2.7 升至 4.1.12，移除旧 tinypool 链并修复 mocker；覆盖 `js-beautify → glob` 至 `^14.0.2`、`minimatch` 至 `^11.0.1`。干净安装、组件测试、类型检查和审计均通过。
- **安装脚本许可**：仅批准 `esbuild@0.28.2`，没有全局放开所有依赖脚本。jsdom 26 的 `whatwg-encoding` 弃用提示仍存在，属于非阻塞维护提示。

## 已知设计限制

这些是源码可确认的边界，不应写成已经修复的问题：

- 模块仍使用压缩 v1 接口、扩展名独占和“更小才提交”策略，尚无多操作组合；Cordis 评估不代表框架已经迁移。
- 旧 CLI 路径/快捷方式需更新，旧报告内的绝对 taskFile 作为历史信息保留；使用任务历史或 list 返回的新路径。
- 每个桌面桥接实例只保存一个当前作业，无多作业队列；历史任务持久化独立存在。
- 同一任务有互斥锁，不同任务之间没有全局素材锁。
- 编码器同步串行执行且无超时；安全取消需等待当前文件结束。
- 预览和任务重放读取完整清单，恢复表分页不减少内存数据量；大规模性能没有接手基准。
- TypeScript 的 `JobRequest.mode` 仍是宽泛 string，部分返回接口只覆盖 UI 使用字段；后端白名单是实际运行约束。
- 配置保存可捕获错误并回滚，但没有跨多个配置文件的崩溃事务协议。
- 当前没有 CI、lint/formatter、commitlint 钩子、自动发布或更新机制。

## 后续建议

| 优先级 | 事项 | 完成标准 |
| --- | --- | --- |
| 下一项业务需求 | 以图片或音频调整验证操作契约 | 明确 operation/provider、验收策略、版本快照与旧任务兼容；不得将仅更名视为已支持 |
| 条件触发 | Cordis 隔离原型 | 出现共享服务或动态插件需求后，按专项评估验证生命周期、Node 24/26、打包和安全回归，再决定生产接入 |
| 高 | 补齐随附编码器的来源与许可记录 | 对 PNG/JPG/MP3 EXE 记录来源、版本、哈希和许可依据；对外发布前核对分发条件 |
| 中 | 建立可重复的验证流水线 | 在可用 Windows 环境执行分层检查，产物与失败日志可定位；不在其他平台把跳过视为通过 |
| 中 | 加强跨层契约类型 | 先评估 mode 联合类型和请求/响应映射，保持现有 CLI/磁盘格式兼容 |
| 按需求 | 大任务和异常进程体验 | 测量内存、日志重放、轮询体积及编码器挂起行为，再决定是否重构 |

后续建议按用户需求选择范围，不顺带重构文件安全和持久化机制。
