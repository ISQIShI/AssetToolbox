# 后端与框架设计

源码入口：`desktop/src-tauri/src/main.rs` 与 `resource-core/{desktop-bridge,batch,engine,tasks,restore,settings}.js`。

## 宿主和调度

Rust 保持一个 Node JSON Lines 会话，对 invoke 请求串行派发；目录选择和打开报告留在原生层。桥接将消息委托给 ApplicationService 的本地桌面上下文，由应用动作白名单与 JobSession 管理临时目录、工作进程、轮询和 cancel。结构化 CLI、HTTP API 和两种 MCP 传输使用同一服务的受限 Agent 上下文，见[HTTP 专题](http.md)。宿主退出或失联时等待当前文件结束再清理。stdout 是桌面/stdio 协议通道，扩展日志使用 stderr。

`batch.runJob()` 将 preview/process 分派到引擎，resume/retry 加载原任务快照、取锁并重读事件，恢复操作分派到 `restore.js`。配置或注册器失败时，恢复路径仍可运行。临时会话 ID 与持久 taskFile 不可混用。

## 执行引擎

`prepareFolder()` 规范化 pipeline、校验路径并递归扫描，排除链接和目标子树。`scanFolder()` 统计资源类型、大小、启用范围及输出冲突；允许只读依赖探测，不打开素材编码。

`processFolder()` 只准备当前文件范围需要的提供方；同一提供方的多个操作共用一次 prepare 和固定工具路径。逐文件读取原始字节，验证资源类型，将当前结果写入临时输入，按 `step.operation` 调用 `provider.adapters[operation].execute`，显式传入 operation、公共参数和该适配器专属参数，再验证输出位置/格式并按操作策略接受或跳过。注册器由适配器生成支持关系，参数、版本及返回值见[扩展契约](extensions.md)。流水线失败返回原始字节及错误，不提交部分结果。

另存用 `wx` 排他创建，已有不同文件保留；重试仅能替换本任务拥有且哈希未变的失败副本。覆盖先写备份，再在源目录生成临时替换文件、fsync、再次校验源内容并 rename；替换失败撤销本次新建备份。记录 `resourceType`、逐步结果和哈希，summary.processed 统计实际改变的文件；savedBytes 可负。

## 持久任务与恢复

扫描完成后写 plan；提交前 intent，提交后 result。任务日志刷盘、PID/token 锁及崩溃判定见[持久化](persistence.md)。续跑只选 pending，重试只选 failed；类型、操作、提供方及适配器版本缺失或不一致拒绝续跑，参数来自任务快照。

恢复是通用文件安全服务，不是转换操作。恢复前核对备份和目标哈希，目标必须仍等于原处理结果或已经等于备份；用户编辑及目录链接均保护。显式 selection 固定预览哈希和路径，筛选不改变已勾选项。写恢复结果同样使用排他创建/原子替换，继续恢复依据日志和磁盘内容判定。无任务记录的独立备份导出也不覆盖不同内容。

## 错误与边界

参数和依赖预检错误在提交前失败；单文件错误继续后续文件；报告写入错误告警，不回滚素材或抹掉日志。取消是协作式文件边界取消；各提供方决定工具调用超时。GUI/CLI/MCP 工作进程已按同一用户与核心安装串行执行，见[自动化专题](automation.md)；此锁不覆盖其他安装副本或外部编辑器，也不是整批事务。源文件大小、时间戳与哈希继续保护冲突。扩展可信，不能把路径检查视为恶意代码沙箱。

验证：`contract`、`resize`、`compress`、`resources`、`batch`、`desktop`、`resume`、`restore`、`restore-preview` 核心测试，以及真实原生 E2E。

## 音频与只读步骤

FFmpeg 提供方的三个 adapters 共享探测与测量实现，增益只使用固定 volume；详情见[音频专题](audio.md)。引擎支持 observe：验证输入未变且无输出，只记录 metadata。每个文件只有观察步骤时跳过素材提交，仍写任务结果；受保护转换在准备阶段要求另存或备份。batch 汇总音频步骤到完整报告/audio.csv，界面仅接收前 100 条。
