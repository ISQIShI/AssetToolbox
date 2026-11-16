# MCP 状态查询与作业记录原子发布验收

日期：2026-11-15。基线 `de64bed`；修复只提交 main，不移动 v1.0.0 标签或自动发行新版本。应用 /8、job /6 与产品版本值保持不变。

## 根因与复现证据

旧实现用 `openSync(..., 'wx')` 或 `writeFileSync` 直接创建最终 JSON 路径；排他创建不等于原子发布。其他入口的 status/队列扫描可以在文件已存在但内容尚未写入时读取，从而抛出 `Unexpected end of JSON input`，公共响应包装为 `INVALID_REQUEST`。首次 job 目录也先建立再写元数据，列表可能看到未完成的身份。

此前日志只记录 `ok:false`，未保存错误正文，不能追溯具体命中了 dispatch 还是 worker 文件。本轮未修改实现时连续运行原五入口用例 20 次均通过，因此不以压力重跑次数判定修复；改用隔离进程门闩固定 open/write 窗口：

- 真实 HTTP MCP 提交预览并断连，暂停服务写 dispatch.json 或 worker.json，再由另一真实 stdio MCP 和桌面应用上下文查询。旧实现两项均稳定返回上述 JSON 解析错误；放行后作业成功，证明不是 HTTP 断连取消了作业。
- 在旧提交源码的隔离副本运行新增核心测试：新 job 可见性、dispatch、worker、exit、等待取消与启动失败六项全部失败。
- 修复后同一组 MCP 两项通过，核心 publication 八项通过；补充排他写者、已有记录拒绝覆盖、磁盘同步失败清理、非硬链接发布及持久损坏仍拒绝的安全断言。

该证据确认并覆盖共享应用层的半写入记录竞争；历史另一次 fetch ECONNRESET 不据此宣称已定位，本轮未复现该网络错误。

## 修复

新增 `application/publication.js`：通过同名 `.writing` 目录预约首次写者，写临时 JSON、fsync/关闭后重命名到不存在的最终路径。目录预约保证同名写者排他，已有普通/链接目标均拒绝，不使用硬链接绕过维护规则。首次 job 元数据写在同级 `.pending-*` 目录，再整体原子公布为 jobId 目录。

service 与 JobSession 共用该实现，涵盖 job、dispatch、request、worker、exit、取消及启动失败终态；运行 status 的既有临时替换不变。保持退出确认、幂等和原文件保护；不增加客户端重试、吞掉损坏 JSON、调整超时或放宽权限。崩溃暂存目录不自动扫描为作业或接管，未知内容仍受维护保护。

`.gitignore` 增加各层 `.claude/`、`.agents/`；已跟踪的 `.claude/launch.json` 只从索引移除，本地保留。同步发布文档解释自动 GITHUB_TOKEN、默认 GITHUB_* 变量和步骤级 env，不新增仓库 Secret 或环境设置。

## 验证

Windows x64；开发 Node 26.13.0、便携 Node 24.19.0、Rust 1.99.1。测试均使用生成素材与隔离副本。

| 命令 / 范围 | 结果 |
| --- | --- |
| 未修复实现的 MCP 门闩回归 | 2 项按预期失败，完整响应为 INVALID_REQUEST / Unexpected end of JSON input |
| 旧源码隔离副本的六个核心发布窗口 | 6 项按预期失败；使用便携 Node 24.19.0 |
| `node --test resource-core/tests/publication.test.js` | 8 项通过 |
| `npm test --prefix resource-core` | 186 项通过，含全部 source/codecs |
| `npm test --prefix agent-mcp` | 9 项通过，含两种协议协商、双传输及五入口行为 |
| `npm test --prefix desktop` | 61 项通过 |
| `npm run build --prefix desktop` | 类型检查、前端生产构建、Tauri release 构建通过 |
| `npm run test:e2e --prefix desktop` | 新 EXE + 修复后核心，3 项通过，约 1 分钟 |
| 文档链接 / 源码发布检查 / diff 检查 | 76 篇文档链接有效；源码边界和空白检查通过 |
| `git check-ignore -v --no-index` | 根目录及嵌套目录的 .claude/.agents 均命中；launch.json 本地仍存在 |

EXE SHA-256：`0bd21b435c4d60233f5c69875084953d6d835ccc2e79bd79d314b858ea6338e4`，只留本地。原始证据在忽略目录 `.local/maintenance/mcp-status-before-*`、`mcp-publication-*`、`mcp-fix-*`。

本轮未重跑联网安装 E2E：安装清单与下载实现未变。远端源码 CI 结果在推送后补充；已有 v1.0.0 Release 不包含此次修复。
