# 项目接手状态

核验日期：2026-11-08（America/Los_Angeles）。接手源码基线为 `e05512d`，文档基线为 `a2f2db9`；本轮继续配置开发环境并验证当前源码。后续任务结束时按[文档管理规范](documentation.md)维护。

## 已建立的基线

- 本地 Git 默认分支为 `main`；首个提交为 `chore(repo): 初始化本地仓库并纳入项目基线`，未配置远程仓库。
- 项目主要语言为简体中文，新提交使用 Conventional Commits。
- 建立文档索引、管理规范、前端/后端架构、通信协议、持久化契约、开发流程和架构决策记录。
- 用户配置、任务、报告、素材及现有便携运行文件保留在磁盘；用户数据和生成产物不进入源码历史。
- 新增 `.nvmrc`、`rust-toolchain.toml`、`.vsconfig`，固定开发版本与原生组件；新增 `npm run typecheck`。
- 修复开发依赖审计问题并完成锁文件干净安装。业务代码与现有测试断言未因环境安装而修改。

## 当前环境与验证

| 检查 | 结果 |
| --- | --- |
| 本地 Git | 2.56.0.windows.4，main 分支，无远程仓库 |
| 随附 Node | `runtime/node.exe` 为 v24.19.0 |
| 开发 Node/npm | 真实用户环境已安装 Node 26.13.0、npm 11.20.0，nvm 2.0.1 管理；沿用现有默认版本 |
| Rust | 新安装 rustup 1.29.3、rustc/Cargo 1.99.1，host/target 为 x86_64-pc-windows-msvc；包含 rustfmt 与 Clippy，用户 PATH 已配置 |
| C++ 与 SDK | 新安装 Build Tools 2022 17.14.44（17.14.37827.9）、MSVC v143（cl 19.44.35229.0，工具目录 14.44.35207）、Windows SDK 10.0.26100.0；安装器退出码 0，组件完整，无需重启 |
| WebView2 | 已有 Evergreen Runtime 157.0.4341.42 |
| 前端依赖 | 更新后 `npm ci --no-fund` 通过；Vue 3.5.44、Vite 7.3.7、TypeScript 5.9.3、Vitest 4.1.12、Playwright 1.64.1 |
| 依赖审计 | `npm audit --json`：0 项；初始为 6 moderate、2 critical |
| 核心回归 | `resCompress/` 中 `npm test`，开发 Node 26.13.0：89 通过、0 失败、0 跳过，约 55 秒；接手时便携 Node 24.19.0 同套件也已通过 89 项 |
| 组件测试 | `desktop/` 中 `npm test`：Vitest 4.1.12，2 个文件、8 项全部通过 |
| 类型检查 | `desktop/` 中 `npm run typecheck` 通过，包含界面、测试和配置 |
| 前端构建 | 最终锁文件下 `npm run build` 内的类型检查与 Vite 7.3.7 打包通过，24 个模块 |
| release 构建 | `desktop/` 中 `npm run build` 通过，Rust release 编译约 4 分 29 秒；已生成并复制新的根目录 EXE |
| 原生 E2E | 使用新构建 EXE 执行 `npm run test:e2e`：1 项综合用例通过，约 24.2 秒；覆盖配置、动态模块、另存、取消、续压、重试、选择性恢复、重启和运行中关闭 |
| 用户数据保护 | 构建前后核对 14 个用户配置、任务及报告文件的哈希，0 项变化 |

验证使用正常 Windows 文件权限，测试仅操作生成样本与隔离副本。详细日志保存在 Git 忽略目录 `.local/validation/`；构建前原 EXE 副本保存在 `.local/backups/`。

根目录 `ResourceCompressor.exe` 为 8,972,288 字节，与 `desktop/src-tauri/target/release/resource-compressor.exe` 的 SHA-256 一致：`542ce0d08a0da4c238e3f0b0e2367d50e7a8ca5df798d7dac2dad2c11ea351c3`。E2E 的 6 张截图保存在 `desktop/test-results/`，已核对紧凑布局和选择性恢复界面。生成产物与日志不提交到 Git。

## 本轮处理的问题

- **环境检测失真**：沙箱重定向 LocalAppData 导致 nvm 误报未激活；普通用户环境实际已有可用 Node/npm。更新环境说明，避免重复安装。沙箱也会阻止测试中的 rename/链接，相关验证在正常权限环境执行。
- **原生工具链缺失**：安装 Rust MSVC 工具链，并安装 C++ Build Tools 与 SDK；固定版本及组件清单，记录新终端刷新 PATH 的方式。
- **开发依赖漏洞**：Vitest 3.2.7 升至 4.1.12，移除旧 tinypool 链并修复 mocker；覆盖 `js-beautify → glob` 至 `^14.0.2`、`minimatch` 至 `^11.0.1`。干净安装、组件测试、类型检查和审计均通过。
- **安装脚本许可**：仅批准 `esbuild@0.28.2`，没有全局放开所有依赖脚本。jsdom 26 的 `whatwg-encoding` 弃用提示仍存在，属于非阻塞维护提示。

## 已知设计限制

这些是源码可确认的边界，不应写成已经修复的问题：

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
| 高 | 补齐随附编码器的来源与许可记录 | 对 PNG/JPG/MP3 EXE 记录来源、版本、哈希和许可依据；对外发布前核对分发条件 |
| 中 | 建立可重复的验证流水线 | 在可用 Windows 环境执行分层检查，产物与失败日志可定位；不在其他平台把跳过视为通过 |
| 中 | 加强跨层契约类型 | 先评估 mode 联合类型和请求/响应映射，保持现有 CLI/磁盘格式兼容 |
| 按需求 | 大任务和异常进程体验 | 测量内存、日志重放、轮询体积及编码器挂起行为，再决定是否重构 |

后续建议按用户需求选择范围，不顺带重构文件安全和持久化机制。
