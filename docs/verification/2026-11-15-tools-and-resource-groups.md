# 工具面板与资源类别分组验收

日期：2026-11-15。基线 `9a77d21`。用户确认本轮只统一分类和界面分组，一个步骤仍对应一种明确格式；没有合并 JPEG/PNG 适配器或改变配置、任务、应用契约。

## 变更与边界

- 服务与存储维护共用折叠标题样式，取消服务面板额外底线和外边距。展开按本机服务、访问配置、Agent 连接分区，权限、服务生命周期及五个公共动作保持原实现。
- 刷新服务状态保留尚未保存的配置输入；运行时禁用配置，令牌正文仍不显示，收起/离开页面不停止服务。
- `resource-groups.ts` 读取目录 kind，图片/音频下分别保留格式。工具、来源、扫描、步骤下拉及添加步骤菜单统一分组；搜索支持中文类别和原始 kind，未知类别/格式不丢失。
- 过滤器 eq/ne 可从目录选择类别/格式，保存 image/audio/jpg/png 等原始 ID；其他字符串操作保留文本输入，目录外旧值不静默改写。未改变过滤求值或恢复逻辑。

## 实际验证

Windows x64，开发 Node 26.13.0，便携 Node 24.19.0，仓库锁定 Rust 工具链。测试使用生成素材、隔离核心与独立配置，没有操作真实素材。

| 工作目录 / 命令 | 结果 |
| --- | --- |
| desktop：`npm test` | 8 个文件、57 项通过；新增 4 项类别、未知扩展、过滤 ID 和扫描合计回归 |
| desktop：`npm run typecheck` | 通过；原生构建内再次执行通过 |
| desktop：`npm run build` | Vite、Rust release 及便携 Sharp 校验通过 |
| desktop：`npm run test:e2e` | 新 EXE 3 项通过，58.3 秒 |
| 根目录：`node scripts/check-docs.cjs` | 57 篇文档，无失效链接 |
| 根目录：`node scripts/check-release.mjs --source` | 通过，未包含第三方二进制 |
| 根目录：`git diff --check` | 通过 |

原生测试核对两折叠标题的横坐标/高度相等、分类包含 JPEG/PNG/MP3，执行真实 HTTP/MCP 服务配置、启停和连接配置生成；运行期配置禁用、令牌不泄露及窗口退出停止服务继续通过。原有音频、图片过滤/处理、取消/续跑/重试、选择恢复和存储维护通过。

截图位于 `desktop/test-results/native/native-native-portable-app-78f37--selective-restore-relaunch-native/`。已查看 tools-panels-1220-light.png、services-1220-light.png、services-840-dark.png、resource-groups-840-dark.png；折叠面板样式一致，展开区域可滚动，未横向溢出。测试目录额外包含合成提供方和资源，实际安装按自身目录显示。

## 产物与未执行项

本地 `AssetToolbox.exe` 为 9,079,296 字节，SHA-256：`8ad81eb3ae8d4970956e731928dfb14f04deb7d85831e22f385cfb5804c0a90c`。日志留在 `.local/maintenance/tools-{ui,build,native}.log`，EXE 不提交。

核心和独立 MCP 源码未改，本轮没有重跑其全量测试；最近 178/7 项通过见[属性过滤验收](2026-11-15-resource-filters.md)。未重跑联网下载安装测试、远端 CI 或性能基准；新 EXE 的联网安装不能沿用旧 EXE 成功记录作为本轮验收。未实现单步骤跨多种格式、类别级统一提供方或新的分类协议。
