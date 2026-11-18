# 音频筛选与桌面操作目标验收

2026-11-17，Windows x64，基线 `5ca9842`。开发 Node 26.13.0，便携 Node 24.19.0。所有运行使用生成素材或隔离副本。

功能提交分别为 `994107a`（MCP 连接轮换）、`1305ed8`（恢复与任务选择）、`3691047`（音频属性过滤）。

## 可复现的行为

- 桌面旧版预览独立备份后，修改目标仍可从旧表提交。对应来源切换、失效结果、选择保持与旧事件的六项 App 测试均在旧版失败，本轮全部通过。任务搜索后仍可操作隐藏任务的四项回归同样在旧版失败，本轮通过。
- 核心按文件头读取 WAV/FLAC 时长、采样率和声道。源码用例验证 FLAC 36 位计数、总采样数未知及错误可定位到文件。WAV 虚拟输入跳过 512 MiB 附加块与超过 4 GiB 的 RF64 数据区。大文件用例只验证元数据偏移及读取量。
- FFmpeg 生成的普通 PCM16 单声道、extensible PCM24 六声道及 RF64 浮点双声道样本均为 48 kHz、0.25 秒，三个属性与 FFprobe 一致。真实 FLAC 步骤的三项属性同时匹配后成功处理。
- MCP 五入口测试扩展后，一次全量运行得到空正文 HTTP 503。单连接顺序 ping 稳定复现了同一响应：旧版第 100 次 SSE 响应仍声明 keep-alive，第 101 次被 Node 拒绝。修复后第 100 次携带 close，第 101 次在新连接上成功返回对应消息。应用服务仍按原逻辑受理作业，服务退出时的结构化 503 保留。

## 本机命令与结果

| 目录 | 命令 | 结果 |
| --- | --- | --- |
| resource-core | `npm test` | 193 项通过，含真实编码器。最初的受限沙箱禁止回环连接及目录联接，本机权限下运行全量通过 |
| desktop | `npm test` | 10 个测试文件、79 项通过 |
| desktop | `npm run build` | 类型检查、Vite、Tauri release 及便携 Sharp 校验通过 |
| agent-mcp | `npm test` | 10 项通过，含真实 stdio/HTTP MCP、CLI、HTTP API 及桌面桥接的目录、规范化、预览对照 |
| desktop | `npm run test:e2e` | 3 项通过。0.5 秒 FLAC 与 2 秒 WAV 的原生界面筛选、实际输出和原文件字节符合预期。独立备份改选后仅新目标收到文件 |
| 根目录 | `node scripts/version.mjs --check`、`node --test scripts/tests/*.test.mjs` | 版本一致，发布工具 5 项通过 |
| 根目录 | `node scripts/check-docs.cjs`、`node scripts/check-release.mjs --source` | 82 份文档链接检查通过，源码发布范围检查通过 |

本地 EXE 为 9,131,008 字节，SHA-256 为 `cf3b14374942abaad8d5d87d73215bcd25cbb0710c45d88be6c27a92eaee20cc`。

联网依赖安装 E2E 未执行。本轮未修改依赖清单、下载器或分发范围。受限沙箱和本机测试的原始输出位于忽略目录 `.local/maintenance/nov17-*`。
