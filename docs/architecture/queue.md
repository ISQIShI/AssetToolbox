# 持久队列与有限并行

状态：已实现单安装的资源感知队列，并行数量 **1–8，默认 2**，最多保留 **100** 个未结束作业。应用/响应 /8、HTTP /api/v8、job/6、dispatch/3、execution/2、resources/1。决策见 [ADR 0014](../decisions/0014-resource-aware-concurrency.md) 和 [0015](../decisions/0015-configurable-concurrency.md)；入口与生命周期见[统一应用接口](application.md)。

## 配置、CPU 建议与稳定槽位

公共 `queue {}` 返回当前预算、全局运行/等待数量、按编号排列的 slots、授权范围内的 waiting，以及 canConfigure。每个槽位为 `{slot,occupied,job}`，编号从 1 开始；无权查看或缺少作业记录的活占用只显示 occupied，不返回他人 ID、路径或参数。queue 是独立于历史分页的活动快照，最多 100 项；历史列表仍用 jobs 分页。

`scheduling-set {maxConcurrent}` 仅允许受信任桌面或显式 `--local` CLI，在提交锁与独占执行屏障内确认全局队列空闲后更新；policy CLI、HTTP 和两种 MCP 均返回 PERMISSION_DENIED。忙碌返回 BUSY，不延后隐式应用。submit 不能指定预算或槽位。设置以 scheduling/1 原子写入 `data/scheduling.json`，缺省读取默认 2；损坏、未知版本和链接文件拒绝，不静默覆盖。

CPU 核心数不直接作为作业上限。queue 返回 availableProcessors（Node availableParallelism 可用逻辑处理器）及 recommendedConcurrent：`clamp(floor(availableProcessors / 4), 1, 4)`。这是为编码器内部并行留余量的保守启发式；例如 12 个可用逻辑处理器建议 3 项。桌面提供“一键采用建议值”，仍需空闲且显式确认应用；默认不随硬件自动变化。手动可设 1–8，建议值不是性能测量、物理核心数、线程或内存配额。

[Sharp 文档](https://sharp.pixelplumbing.com/api-utility/)说明每幅图像的处理也使用多个线程，[FFmpeg 文档](https://ffmpeg.org/ffmpeg.html)也提供滤镜线程设置；当前只限制作业 worker 数，不修改提供方内部线程。后续应先测量吞吐、内存和交互响应，再设计提供方级线程/内存预算，不能宣称并行数越大越快。

调度器从空闲编号中分配槽位，dispatch/3 预约与 execution/2 占用携带同一 slot。直到确认退出前保持编号，其他作业结束不使卡片上移；重复、越界或预约与 worker 占用不一致时保守拒绝。预算只能空闲调整，因此不会缩掉正在执行的槽位；已完成历史仍按硬上限 8 校验，不受后续降低预算影响。

## 调度与公平性

桌面、CLI、MCP stdio/HTTP 和 HTTP API 共用 ApplicationService。提交锁内预检请求、权限及依赖，计算资源集合，分配递增 sequence，排他写入并 fsync `data/jobs/v6/<jobId>/job.json`。幂等键重放原 ID；容量满不登记身份。capabilities.scheduling 公布当前 maxConcurrent、范围、maxPending 和 ordering=conflict-fifo。

各原持有会话每 100ms 调度一次；无需常驻进程。调度同时取得提交锁、短执行登记锁，从持久启动声明和存活 worker 占用计算容量；启动声明一经落盘就占槽，不等待 worker 自己抢槽。只有原持有者可以启动自己的作业，不转移权限。

按 sequence 从早到晚选择候选：与运行项冲突则等待；与任何较早等待项冲突也等待；否则可使用剩余槽位。这样无关作业可越过受阻项，而后来读者不能不断抢在早期写者前面。较早的可运行项即使属于其他会话也保留槽位优先权。无优先级和手动重排，不保证失去响应的持有者有时间上的完成上限。

## 资源占用契约

整个集合一次判定、一次授予，不逐个等待锁。读读共享；同资源的读写、写写互斥。目录包含所有后代，解析已存在父目录的真实位置及 junction/symlink 别名，Windows 大小写折叠；相似前缀的兄弟目录互不冲突。素材、输出、备份不能覆盖核心目录或包含核心的上级目录，受信任本地入口也遵守。

| 作业 | 资源声明 |
| --- | --- |
| 另存处理 | 源目录读、输出目录写、所用提供方读 |
| 覆盖处理 | 源目录写、备份根目录写、所用提供方读 |
| 纯分析 | 源目录读、所用提供方读；不声明素材写入 |
| 扫描预览 | 源目录及配置的保存目录读、提供方读 |
| 续跑/重试 | 从任务快照推导原处理资源，另加任务目录写 |
| 恢复 | 原源目录写、备份会话读、任务目录写 |
| 恢复预览 | 原源目录、备份会话、任务目录读 |
| 备份导出/预览 | 备份目录读、目标目录写/读 |
| 安装/更新依赖 | 指定提供方写、其受管理目录写；其他提供方可同时使用 |

资源声明来自核心推导，客户端不能传入或缩小。依赖更新不会与同提供方的读取/处理并行；旧依赖目录仍不可变。备份按根目录保守互斥，不利用新建 UUID 子目录放宽保护。共享读取同样受当前并行预算约束。

## 启动、执行与维护屏障

启动前重验原上下文、路径、规范化请求和资源快照；worker 再推导资源、校验父进程与 dispatch，并执行原步骤版本/哈希检查。队列期间目录改成别名或任务资源范围变化会失败，不能悄悄换锁范围。原任务锁、文件哈希、原子提交和恢复选择保持不变。

worker 独立登记 execution/2 占用（PID、随机 token、jobId、资源集合），和调度者共用短执行登记锁；因此父进程崩溃或 worker.json 尚未发布时，活 worker 的资源仍受保护。未经过调度的底层 runJob 使用独占执行屏障，不能绕过活共享占用。登记锁只覆盖元数据操作，不覆盖编码耗时；全部锁遵循提交锁→执行登记锁顺序，worker 不反向取得提交锁。

登记锁的排他创建返回 EEXIST 后，原持有者可能在读取 owner.json 前正常释放；仅这个读取窗口的 ENOENT 转为 BUSY，复用既有有界等待，不直接授予执行权。坏 JSON、无效 PID、权限与其他 I/O 错误仍保守拒绝。worker 在业务 finally 中不删除独立占用，由后续读取确认 PID 已退出后回收；因此“业务完成但进程仍活着”不会因父进程死亡、worker.json 缺失而提前释放资源。内部非 worker 的显式共享占用仍由调用者释放。

存储清理持有提交锁和独占执行屏障，并拒绝任何等待/运行项；排队、启动中、孤儿 worker 均不能被清理穿过。取消不提前释放占用。正常运行必须确认退出后才释放持久启动预约；无进程创建的启动失败写最终状态和退出确认，防止永久卡槽。

## 状态与取消

queued 状态包含 sequence、queuePosition、waitReason、runningCount、concurrencyLimit。queuePosition 是包含运行项的登记顺位，**不是启动顺序或预计时间**。waitReason 为 resource-conflict（运行资源冲突）、earlier-conflict（较早等待项优先）、capacity（槽位满）或 owner-dispatch（等待持有者）。原因是查询时的快照；短执行锁/维护争用和崩溃元数据窗口可能使实际派发继续等待。界面显示原因与槽位用量，不披露其他权限范围的路径或请求。

公共 submit/cancel/queue/scheduling-set 对短暂提交锁竞争最多等待 5 秒；队列满、执行屏障忙碌、会话退出、权限拒绝不重试。低层同步 dispatch 仍可返回 BUSY。等待项取消直接写结束状态，不创建 worker、任务或报告；运行取消在文件边界生效。

桌面、CLI、stdio 正常退出取消自己全部等待与运行项并等待退出。HTTP 客户端断开不取消，服务退出才取消自己作业。纯观察窗口关闭不影响其他入口，显式 cancel 可在授权范围内跨入口执行。桌面仍一次配置一个本会话作业；作业中心可观察多个并行项。

## 崩溃与版本边界

持有者死亡的等待项中断，不自动接管权限或重放。dispatch 落盘后永不再次启动同 ID。活 worker 继续占用，父进程死亡后按文件边界取消；确认 PID 已死的临时执行占用才回收。PID 重用、坏记录和丢失退出确认保守阻塞，不超时强抢、不强杀编码器。素材任务通过显式 resume/retry 恢复。

旧 HTTP 1–7 返回 410，旧 job/1–5 不读取或迁移；新目录内旧 schema、未知 dispatch/resources/执行占用格式拒绝。task/report/settings 和提供方契约不变。升级必须关闭旧入口并配套更新 EXE、核心与 MCP；不支持同一安装同时运行旧执行锁实现。

锁只协调同一安装，不是跨安装或 OS 沙箱；外部编辑器、同权限篡改和不同安装访问相同素材仍需操作者协调。没有后台接管、自动恢复、分布式调度、目录索引或自动清理。同步扫描历史记录仍是性能边界。

源码：`application/{service,scheduling,queue,resources,execution,lock,job-session}.js`。核心 scheduling/queue/parallel/storage、MCP 双传输及原生桌面/CLI 并行验收，实际结果见[项目状态](../project-status.md)。
