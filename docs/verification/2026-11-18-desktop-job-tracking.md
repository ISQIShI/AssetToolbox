# 桌面断连与作业跟踪验收

2026-11-18，Windows x64，基线 `3a59819`。开发 Node 26.13.0，便携 Node 24.19.0。

## 旧版复现

阻断桌面的 `status` 后，旧版 `poll()` 的异常分支自行写入 `done: true, exitCode: 1`。旧 EXE 在后台 worker 仍运行时显示“未完成”并停止查询。另一个入口是恢复结果第二页或音频明细读取失败，两者也会覆盖核心已返回的成功终态。旧 Rust 宿主还会一直保留已退出的桥接句柄。

六项组件回归均在旧实现上失败。原生旧版复现使用独立副本、生成的 JPEG 及仅阻断查询的门闩，日志保存在本地 `.local/maintenance/`。

## 修复验证

- `desktop/tests/job-tracking.test.ts` 连续阻断状态查询，保留最后进度并拒绝另一 jobId 的终态。恢复后只查询原 ID，直到确认成功、失败或取消。覆盖关窗时取消发送失败后重发、结果第二页失败后手动重读、关闭卡片或卸载时的迟到响应。
- `filters-native.spec.ts` 让独立观察者核对同一真实 worker 的运行及退出。旧桥接丢失一次响应并退出后，检查新桥接 PID、UI 的原 jobId、单次处理提交和唯一输出。两个尺寸与主题的提示截图保存在 `desktop/test-results/native/`。
- 自动恢复针对已有 jobId 且查询能返回成功或错误的场景。宿主没有给阻塞中的管道读取增加超时。桥接退出时，核心仍可根据实际情况返回取消或中断。

## 本机验收结果

| 检查 | 结果 |
| --- | --- |
| 桌面组件与类型 | 在 `desktop/` 执行 `npm test` 通过 85/85，其中 6 项为本轮回归。`npm run typecheck` 通过 |
| 原生构建 | 在 `desktop/` 执行 `npm run build`，Vite、Rust release 和便携依赖校验通过 |
| 原生 E2E | `npm run test:e2e` 通过 3/3，覆盖真实音频、图片过滤与断连续查、取消及选择性恢复 |
| 联网 E2E | `npm run test:e2e:network` 通过 1/1，实际下载安装和更新依赖，并用托管 Sharp 处理图片 |
| 核心与 MCP | 核心全量单独复测通过 193/193，MCP 双传输及跨入口全量单独复测通过 10/10 |
| 发布工具与文档 | 5 项发布工具测试通过，产品版本一致性、文档链接及源码分发检查通过 |

两组 E2E 均运行本次构建的 `AssetToolbox.exe`，大小 9,129,472 字节，SHA-256 为 `97ea9ffd192a2b0ebfd8c9249a02b93c1fe1326328c917da54b3d2b1b6b14849`。本地日志在 `.local/maintenance/tracking-*.log`，原生断连截图为 `job-status-offline-1220-light.png` 和 `job-status-offline-840-dark.png`。

## 首轮检查的间歇性失败

首轮并行验收出现两次失败。MCP HTTP 取消用例遇到 `ECONNRESET`。核心 CLI 恢复预览返回退出码 1，旧断言只输出 stderr 的作业回执。现已让断言同时附带 stdout 的结构化响应。该 CLI 用例用独立夹具并发复跑 30 次全部通过，两项首轮失败的根因仍待复现。
