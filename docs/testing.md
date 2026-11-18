# 测试分层与 CI

源码入口：`scripts/test-core.cjs`、`.github/workflows/source.yml`、`desktop/playwright.config.ts`。所有文件处理测试使用生成素材和隔离副本，不能以真实用户目录作为夹具。

`desktop/tests/job-tracking.test.ts` 验证查询中断、同一作业恢复跟踪、取消与关窗、完整结果重读和迟到响应。`filters-native.spec.ts` 在隔离副本阻断状态读取、观察实际 worker 退出并终止原桥接，核对新桥接返回同一作业的终态和唯一输出。

从根目录运行以下命令，可让 HTTP 拒绝上传、MCP 取消、CLI 恢复预览与跨入口终态查询同时执行。各文件使用独立便携副本。取消用例在第二个文件处理期间取得取消回执，再放行并核对续跑的六个文件。

```powershell
node --test --test-concurrency=4 resource-core/tests/http.test.js agent-mcp/tests/http.test.mjs resource-core/tests/restore-preview.test.js resource-core/tests/publication.test.js
```

音频属性的 source 用例为 `audio-properties.test.js`、`wav-properties.test.js`，覆盖有界读取、无时长、损坏头部、跨格式来源筛选和写入前失败。真实编码文件另由 `audio.test.js` 和原生 `audio.spec.ts` 验证。桌面恢复改选、晚到事件和任务搜索分别由 `app.test.ts`、`task-search.test.ts` 覆盖，原生 `native.spec.ts` 核对导出后新旧目标的磁盘内容。

## 运行矩阵

| 目录 | 命令 | 前提与范围 |
| --- | --- | --- |
| `resource-core/` | `npm run test:source` | 安装锁文件依赖；验证契约、应用、HTTP、恢复、存储及依赖安全，不需要第三方 EXE |
| `resource-core/` | `npm run test:codecs` | Windows、本地 Sharp、pngquant、JPG-C、LAME、FFmpeg 齐全；真实图片/音频及编码器验收 |
| `resource-core/` | `npm test` | 上述两层全量执行；缺编码器明确失败，不静默跳过 |
| `agent-mcp/` | `npm test` | 官方 SDK 客户端验证 stdio、Streamable HTTP 和跨入口契约 |
| `desktop/` | `npm test`、`npm run typecheck` | 组件、状态管理、类型；不启动原生应用 |
| `desktop/` | `npm run build` | Windows Rust/MSVC/WebView2 与便携依赖；生成当前 EXE |
| `desktop/` | `npm run test:e2e` | 刚构建的 EXE、完整本地工具；原生 UI/音频/恢复/存储，隔离副本下载器禁止联网安装 |
| `desktop/` | `npm run test:e2e:network` | 同上且需要外网；真实 LAME/Sharp 下载、摘要验证、安装、更新及新安装的缩放处理 |
| 仓库根 | `node scripts/check-docs.cjs`、`node scripts/check-release.mjs --source` | 相对 Markdown 链接与源码发布范围 |

核心测试文件必须登记到 `test-core.cjs` 的 source/codecs 清单；未分类或漏文件直接失败。合成提供方验证调度与文件安全，真实编码器测试验证格式和效果，两者不能互相替代。原生测试不得设置 `ASSET_TOOLBOX_AUDIO_BROWSER`；浏览器备用验证单独记录。

`filters.test.js` 属于 source 层，覆盖属性/条件边界、固定清单、版本变化、备份恢复独立性；`resize.test.js` 在 codecs 层验证真实 JPEG EXIF。组件 `filters.test.ts` 验证共享编辑器，MCP `http.test.mjs` 对照五入口选择结果，原生 `filters-native.spec.ts` 用生成 JPG/PNG 验证来源排除、按中间尺寸跳步及原文件不变，并输出两种尺寸主题截图。

## 自动验证

GitHub Actions 在分支 push、pull_request 和手动触发时使用 Windows runner；`workflow_call` 供标签发布复用。按 `.nvmrc` 和三个锁文件安装依赖，执行版本一致性、发布脚本测试、source、MCP、组件、`build:web`、文档及源码检查，完整拉取历史。安装依赖需要网络，但不下载/上传外部编码器 EXE，不执行真实编码器或原生 E2E。源码 CI 不使用仓库写权限、凭据持久化或二进制 artifact；只有[Release 工作流](releasing.md)的发布 job 获得 contents:write，用于创建源码 Release。

根目录 `node scripts/version.mjs --check` 验证产品版本一致，`node --test scripts/tests/*.test.mjs` 验证版本同步、标签/main/说明门槛、模拟 GitHub 发布、重复发布与拒绝边界。该套件独立于核心测试分层，不访问真实发布 API。

官方 Actions 固定提交摘要：[checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1) 对应 `3d3c42e5aac5ba805825da76410c181273ba90b1`；[setup-node v7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) 对应 `949feb2413d6458794dcd2491c4babbbce0c15c1`。升级时重新核对发布及提交来源。

联网失败不能通过放宽 TLS、摘要或断言来解决；独立记录失败和重试结果。构建新 EXE 后必须重新运行原生验收。实际执行结果、未执行项及远端 CI 状态统一记录在[项目状态](project-status.md)。

队列测试位于 resource-core/tests/queue.test.js，属于 source 层。覆盖冲突 FIFO、多个持有者、等待取消/退出、死队首、启动不确定、适配器变化和容量。parallel.test.js 同属 source 层，覆盖真实并行/容量、目录别名、任务/备份/提供方资源、防饥饿、维护屏障、崩溃占用与启动失败。原生 E2E 另覆盖桌面与 CLI 同时处理、取消隔离、冲突排队原因、登记顺位及宿主等待桥接退出。

scheduling.test.js 属于 source 层：覆盖配置范围/持久化/权限、三槽位实跑与溢出排队、匿名占用、忙碌拒绝、降额后历史、重复/越界槽位及坏配置安全。组件验证建议值与服务拒绝；原生验证 3/8 槽位、重启配置、忙碌禁用和两种尺寸主题。

services.test.js 属于 source 层：覆盖公共服务五动作、令牌轮换、授权等权、旧 policy 拒绝、CLI 前台持有/跨进程停止、启动竞争与退出清理。MCP HTTP 用例通过真实 stdio/HTTP 客户端启动和停止受管理监听器；原生工具页面验证配置、实际 HTTP/MCP 请求、生成连接说明及窗口退出释放端口。原生综合用例需要本地 agent-mcp 依赖，测试仅在隔离副本链接该依赖。

lock-races.test.js 属于 source 层：用明确门闩控制“排他创建失败 → 持有者释放 → 读取身份”及“业务结束 → 进程退出”两个竞争窗口，覆盖真实处理/重试 worker、孤儿资源保护、幂等与原文件不变，以及坏记录/权限错误不被吞掉。必须先确认回归在旧实现失败，不能以增加等待时间、自动重跑或删除安全断言代替修复。共享应用测试夹具遇到失败终态时输出完整公共状态；验证记录保留原始日志位置和历史证据边界。

`publication.test.js` 属于 source 层：固定首次记录 open/write 窗口，检查列表/队列可见性、dispatch/worker/exit、取消/启动失败、同步失败清理、排他写入和已公布损坏记录拒绝。MCP HTTP 测试在隔离服务中暂停 dispatch/worker 写入，关闭 HTTP 客户端后从另一个真实 stdio MCP 及桌面上下文查询；同一测试必须在旧实现失败、新实现通过。门闩只存在于测试副本，不在生产入口增加测试开关。
