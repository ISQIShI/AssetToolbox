# 用户文档与首个公开源码版本验收

日期：2026-11-15。基线 `cd17f71`。用户明确授权整理对外文档、将 `ISQIShI/AssetToolbox` 设为 public 并发布首版；本轮采用 `v1.0.0` 正式源码发行，不上传本地 EXE 或第三方依赖。

## 改动范围

- 根 README 收敛为项目介绍、发行范围及导航；新增 `guides/` 独立用户文档目录，覆盖快速开始、使用、依赖安装、MCP、CLI、HTTP、开发部署及排错。
- AGENTS、文档管理与索引明确用户教程/内部契约的维护边界。既有许可、发布规则改为公开源码范围，便携分发限制不变。
- 发布脚本要求仓库 public，保留版本/标签/main/说明、CI 前置与重复发布拒绝；回归测试同时验证非公开/未知可见性拒绝。
- 产品版本值保持 1.0.0，新增首版说明；MCP 测试补状态查询失败时的完整响应诊断，未放宽断言。

## 本地验证

Windows x64；开发 Node 26.13.0、便携 Node 24.19.0、Rust 1.99.1。仅使用隔离样本及本地测试依赖。

| 命令（均可从项目根执行） | 结果 |
| --- | --- |
| `npm test --prefix resource-core` | 178 项通过，包含源码与真实编码器 |
| `npm test --prefix desktop` | 61 项通过 |
| `npm run build --prefix desktop` | 类型、Vite 和 Tauri release 构建通过，生成新 EXE |
| `npm run test:e2e --prefix desktop` | 新 EXE 上 3 项通过，约 1.1 分钟；图片/过滤、音频、服务和恢复 |
| `npm test --prefix agent-mcp` | 首次 6/7，独立复测 7/7；详见下文 |
| `node --test scripts/tests/*.test.mjs` | 5 项通过 |
| `node scripts/version.mjs --check` | 1.0.0，全部版本清单一致 |
| `node scripts/check-docs.cjs` | 75 篇文档，相对链接有效 |
| `node scripts/check-release.mjs --source`、`git diff --check` | 通过 |

本地 EXE SHA-256：`e02cfd4506706547c4a1a683396bafc353ccb9a580a47e84e2d731368584abc8`；该文件不进入 Git 或 Release。

MCP 首次在五入口一致性用例中，关闭 HTTP MCP 客户端后由桌面查询作业时收到 `ok:false`；旧断言未输出错误正文，因此无法据此确定业务原因。补充 JSON 响应诊断后单独复测完整套件通过，定向用例再运行 3 次均通过，不删除断言、增加等待或在 CI 自动重试。首版保留此已知间歇性问题，不宣称根因修复。原始日志位于 `.local/maintenance/first-release-*.log`。

本轮未执行联网依赖安装 E2E：安装行为和核验清单未变化。云端源码验证不代替上述本机原生与编码器验收。

## 公开前审查

- 初始远端只有 main，无标签、Release、Issues/PR 或 Actions 附件；MIT 已识别。4 次既有 Actions 运行日志已下载到忽略目录审查。未启用 Pages/Discussions；Wiki Git 入口返回不存在，无可读取的 Wiki 历史。
- 官方 Gitleaks 8.30.1 固定 Windows 包经上游 checksums 比对；ZIP SHA-256 为 `d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e`。32 个既有提交及 4 次 Actions 日志扫描均无命中；扫描不是没有任何敏感内容的绝对保证。
- 当前树/历史禁止二进制、用户 data、node_modules 和凭据的边界继续由 `scripts/check-release.mjs --source` 核对；公开前还检查最终提交及暂存差异。

## 远端发布

准备完成后推送 main 并等待源码 CI，再修改可见性、推送单个 v1.0.0 标签，由 Release 工作流发布。此处暂不将尚未发生的可见性变更或 Release 创建记为成功；实际结果随后更新本记录与项目状态。
