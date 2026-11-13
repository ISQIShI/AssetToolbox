# 2026-11-12：可配置并行与槽位界面验证

代码基线：`3662963` 加本轮提交。范围：应用 /6、job/5、调度配置、稳定槽位、桌面作业中心与文档分层。规则见[队列](../architecture/queue.md)，当前摘要见[项目状态](../project-status.md)。

## 环境与结果

Windows x64；开发 Node 26.13.0（按 .nvmrc），便携运行时 Node 24.19.0，Rust release/MSVC/WebView2 沿用已配置本地工具链。此机 i5-12400F，12 个可用逻辑处理器、32 GiB 内存；启发式建议为 3，默认仍为 2。没有做吞吐或内存基准测试。

| 工作目录 | 命令 | 实际结果 |
| --- | --- | --- |
| resource-core | `npm test` | 最终 159 通过，0 失败/跳过，35.5 秒；含真实编码器 |
| desktop | `npm test` | 最终 47 通过，1.6 秒 |
| desktop | `npm run typecheck` | 通过；最终构建再次执行 |
| agent-mcp | `npm test` | 6 通过，21.7 秒；stdio/HTTP、五种入口契约一致性 |
| desktop | `npm run build` | 最终通过，Rust release 1 分 18 秒；Vite 与便携依赖校验通过 |
| desktop | `npm run test:e2e` | 最终 EXE 2 项通过，46.4 秒 |
| desktop | `npm run test:e2e:network` | 最终 EXE 1 项通过，19.6 秒 |
| 根目录 | `node scripts/check-docs.cjs` | 49 篇文档，0 个失效链接 |
| 根目录 | `node scripts/check-release.mjs --source` | ready=true；不代表便携二进制放行 |

## 新增验收与修正

- 核心：1–8 范围、持久化、CLI 读取同一预算、policy 禁止修改、submit 不能注入预算；三项同时处理、第四项等待；权限不足的活动作业匿名化。
- 槽位：编号缺口不使其他作业移动，重复/越界占用拒绝；无 job.json 的活 worker 仍占槽；整个作业根丢失保守拒绝。空闲才能改配置，降低预算后仍可读取旧高槽位历史；坏配置、未知版本及硬链接保护。
- 前端：稳定槽位、单独等待卡片、去除历史重复卡片、一键建议值、忙碌禁用、服务拒绝保留原预算、查询失败清除旧配置入口。
- 初次原生及联网验收分别 2/1 项通过。截图发现紧凑窗口详情落在长历史后方，改为保留右侧详情列与固定顶部命令；随后重建最终 EXE 再验收。
- 新增孤儿槽位测试初次夹具未建立作业根，触发既有保守拒绝；修正夹具并保留“缺根拒绝”断言，最终全量通过，未放宽安全逻辑。
- 原生扩展验收：3/8 槽位显示、配置重启保留、忙碌禁用，继续覆盖桌面与 CLI 并行/冲突、取消隔离、退出等待、音频、恢复及存储维护。

## 产物、证据与边界

最终 `AssetToolbox.exe` 为 9,074,176 字节，SHA-256：`2ebcdc61c914981894b03e992c871e5e219d85e6e92891597170d927bf94e30d`。日志位于忽略目录 `.local/maintenance/slots-*.log`；原生截图在 `desktop/test-results/native/`，联网报告在对应 network 输出目录。检查了 jobs-1220-light、jobs-840-dark、parallel-running、queue-waiting 与 jobs-eight-slots，紧凑布局保留详情、顶部命令固定、无横向溢出。测试只处理生成素材与隔离安装副本，未修改真实素材或当前手动依赖。

本轮未执行性能压测、远端 CI、二进制发布或跨安装协调验收。并行上限 8 的配置/UI 已验收，真实处理并发验收到 3；不宣称 8 项生产负载性能最优。源码分发通过不代表第三方便携二进制已获分发许可。
