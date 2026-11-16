# 资源属性与共享过滤器验收

日期：2026-11-15。基线 `a85b66f`；本轮新增属性组、来源/步骤过滤及跨入口接入。长期规则见[属性与过滤器](../architecture/properties-and-filters.md)，版本决定见 [ADR 0017](../decisions/0017-properties-and-filters.md)。全部素材为测试生成，运行使用隔离副本，未处理真实用户素材。

## 环境与结果

Windows x64；开发 Node 26.13.0，便携 Node 24.19.0，仓库 Rust 工具链。本地已有 Sharp、pngquant、JPG-C、LAME、FFmpeg；没有新增外部依赖或放宽下载/许可条件。

| 工作目录 / 命令 | 实际结果 |
| --- | --- |
| resource-core：`npm test` | 178 通过、0 失败/跳过，34.7 秒；包含真实编码器 |
| desktop：`npm test` | 53 通过，含 4 项过滤器组件/模型测试 |
| agent-mcp：`npm test` | 7 通过，29.6 秒；五入口过滤规范化、拒绝、预览及执行结果一致 |
| desktop：`npm run build` | 通过，包含 typecheck、Vite、Rust release 和便携 Sharp 校验 |
| desktop：`npm run test:e2e` | 最终 EXE 3 项通过，58.0 秒 |
| desktop：`npm run test:e2e:network` | 同一 EXE 1 项通过，约 1.4 分钟；真实安装/更新及受管理 Sharp 处理 |
| 仓库根：`node scripts/check-docs.cjs`、`node scripts/check-release.mjs --source` | 56 篇文档无失效链接，源码发布范围检查通过 |
| 仓库根：`git diff --check` | 通过 |

原始日志为忽略目录 `.local/maintenance/filters-{core,ui,mcp,build,native,network}.log`。首轮核心 176 项中，旧空目录摘要断言未包含 discovered/filteredOut，175 通过、1 失败；按新契约补全断言，并新增两项安全回归后完整 178 通过，没有移除原断言。JPEG APP1 审查发现非 EXIF 的 XMP 可覆盖方向，已限定 EXIF 段并补回归；真实 Sharp EXIF 素材也通过。

## 关键证据

- 核心新增 10 项：属性目录/校验上限、PNG/JPEG/EXIF/XMP、按需读取和当前 buffer、来源排除不复制/备份、续跑固定清单、全排除及全跳步无备份、属性版本改变阻止续跑、中间尺寸、损坏头无素材写入、CLI 与旧格式拒绝。
- 恢复回归主动破坏隔离副本的属性模块；仍能按实际备份和显式哈希恢复，证明恢复不加载属性插件。不放宽原有路径、冲突、取消、事务及存储保护断言。
- 五入口测试使用真实桌面桥接、CLI、stdio MCP、HTTP API、HTTP MCP；每个入口从 8 个文件中选 1 个，验证排除 7 个和步骤 filtered，并拒绝未知属性。原有取消、续跑、幂等、分页和服务管理继续通过。
- 原生新增流程生成 80×40 JPG、20×10 JPG、80×40 PNG；界面选择 JPG 且宽度大于 40，仅输出大图。第一步缩放至 20×10，第二步条件宽度大于 30 不匹配；结果步骤为 processed/filtered，三份原文件逐字节不变。
- 原有原生音频、处理/重试/续跑、选择性恢复、服务/作业/存储流程继续通过；联网测试使用独立输出目录，不覆盖原生截图。

截图位于 `desktop/test-results/native/filters-native-native-sour-f3178-d-preserve-excluded-sources-native/`：source-filters-1220-light.png、source-filters-840-dark.png、step-filters-840-dark.png。已人工查看，宽窗口横向条件行、窄窗口属性独占一行，内容可滚动，未横向溢出。

## 最终产物与边界

本地 `AssetToolbox.exe`：9,078,784 字节；SHA-256：`2747e1e82ffbd7fa0f5b4c0b7c7f4f08d2cef53f554ae1809acaeedc8e71e48b`。与核心、便携运行时成套使用；二进制留在本地，不属于源码提交。

图片只读取有界头部，PNG eXIf、音频时长等属性尚未实现；扫描不执行转换，不能预估后续步骤条件。旧 settings/task/job 不迁移；旧备份普通文件可独立导出。当前安全判断仍是单安装协作与按文件事务，不能替代外部编辑器协调。远端 CI、本机之外的运行环境和大规模属性扫描性能本轮未验证。
