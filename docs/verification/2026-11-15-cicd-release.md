# 版本规则与源码 Release 自动化验收

日期：2026-11-15。基线 `b1268de`；远端 main 初始为 `a85b66f`，私有仓库，无版本标签及 Release。本轮不创建真实标签或 Release，不改变现有产品版本 `1.0.0`、核心处理/应用协议和 EXE；MCP 服务版本声明改为读取包元数据。

## 改动

- 根 VERSION 统一九个版本清单位置；支持正式版及 alpha/beta/rc，提供一致性检查和同步命令。
- MCP stdio/HTTP 服务端版本读取包元数据，隔离测试将包改成不同版本并断言握手信息，避免仍写死 1.0.0。
- 源码 CI 增加完整历史、版本和发布工具回归，作为可复用工作流供标签发布调用。
- `v*` 标签通过源码 CI 后核对版本、main 归属、递增及说明，再创建私有源码 Release；只注入最小写权限令牌，预发布与重复执行有明确语义。
- 发布时机、兼容性分级、首版基线、准备/发布/重试与二进制边界写入[发布流程](../releasing.md)，同步 AGENTS、索引、测试及分发文档。

## 本地验证

Windows x64；测试使用开发 Node 26.13.0，发布脚本也用便携 Node 24.19.0 验证。发布单测创建临时 Git 仓库并模拟 GitHub API，不发真实发布请求。

| 工作目录 / 命令 | 结果 |
| --- | --- |
| 根：`node scripts/version.mjs --check` | 1.0.0，全部清单一致 |
| 根：`node --test scripts/tests/*.test.mjs` | 5 项通过：版本/依赖保持、Windows 换行、空说明、标签/main/递增门槛、预发布、幂等与安全拒绝 |
| resource-core：`npm run test:source` | 138 项通过 |
| agent-mcp：`npm test` | 单独复测 7 项通过；首次与核心/前端并行运行时为 6 通过、1 项 ECONNRESET，详见下文 |
| desktop：`npm test`、`npm run build:web` | 61 项、typecheck 和 Vite 通过 |
| desktop：`npm run test:e2e` | 3 项通过，约 1.1 分钟；现有 EXE 与最终核心/MCP 源码组合，包含真实服务联动 |
| 根：`node scripts/check-docs.cjs`、`node scripts/check-release.mjs --source` | 通过 |
| actionlint 1.7.12 | 两个工作流语法/表达式检查通过；禁用不适用的 shellcheck/pyflakes |
| `git diff --check` | 通过 |

actionlint 从官方固定版本下载，Windows ZIP 与官方 checksums 文件比对，SHA-256 为 `6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9`；仅保留在忽略目录。日志位于 `.local/maintenance/cicd-*.log`。

首次 MCP 失败发生在认证/正文边界测试的 fetch，错误为 `read ECONNRESET`；按 CI 的串行套件顺序独立复测通过。没有修改生产服务或删除断言，也未在工作流增加自动重试。现有证据不足以断言根因已修复；若再次出现，按具体 HTTP 请求与连接生命周期单独定位。

## 远端与范围

- 已提交并推送 `c16a306` 及此前未推送的开发提交，仓库保持私有，Release 列表仍为空。
- [GitHub 源码 CI #43814975778](https://github.com/ISQIShI/AssetToolbox/actions/runs/43814975778) 在 `c16a306c24f4001e16f004526b7054b032197ff5` 上全部通过：核心源码、版本/发布工具、MCP 双传输、前端交互、类型/生产前端以及文档/分发检查。远端本次未复现本地 MCP ECONNRESET。
- 真正的标签触发及 Release 创建未执行，避免为验证流程产生虚假的产品发行；发布 API 的调用及失败/重复边界由模拟测试覆盖。
- 未重建 EXE、未执行核心真实编码器全量和联网安装：产品版本值、前端/Rust 与构建配方未变，EXE 沿用[菜单验收](2026-11-15-hierarchical-menus.md)；MCP 版本声明变更另重跑 MCP 和原生服务联动验收。
- main/标签保护、不可变 Release 属于仓库设置，本轮没有自动修改或宣称启用；便携包仍未放行。
