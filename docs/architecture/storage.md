# 存储维护

状态：已实现。默认保留最近 **30 天**，仅在人工预览、勾选并点击清理后执行，不设定时清理。源码为 `application/storage.js`、`application/service.js`、`StorageMaintenance.vue`；决策见 [ADR 0012](../decisions/0012-storage-retention-and-test-layers.md)。

## 范围与保护

| 可清理 | 始终保留 |
| --- | --- |
| 成功结束且超过保留期的作业 `request.json`、`status.json`、`cancel` | `job.json` 中的原请求、作业身份及幂等键，`worker.json`、`exit.json` |
| 该作业唯一引用的 `report.json`、`files.csv`、`audio.csv` | 素材、输出、`data/tasks/` 任务日志及所有备份 |
| 预览作业的执行明细 | 配置、依赖及历史依赖安装目录 |

仅扫描 `data/jobs/v5/<64 位十六进制 ID>/`，报告必须是固定 `data/reports/` 的直接子目录。保留期取作业创建时间及控制/明细文件最近修改时间的最大值；任一仍在保留期就保留整项。允许选择 1–3650 天，修改天数后必须重新预览。

运行、启动、失败、取消、中断、仍可续跑/重试或继续恢复的记录均受保护；可从完整备份恢复的成功任务允许清理报告，备份和恢复日志不动。未知文件、损坏记录、未确认退出、链接/硬链接、共享或无法确认归属的报告均拒绝清理。孤立报告和未知作业目录留待人工核对。

## 公共动作与授权

应用/响应契约为 `/7`，持久 job 为 `/5`。两个动作复用同一 ApplicationService：

- `storage-preview({retentionDays?:30,offset?:0,limit?:50})`：只读，返回分页 items、总数、候选数量和估计明细字节；上限 100，桌面每页取 100 项，可清理项含 fingerprint。
- `storage-clean({retentionDays,selection:[{jobId,fingerprint}]})`：显式选择 1–100 项；返回逐项 cleaned/error、净释放字节估计和汇总。

只允许桌面和显式 `--local` CLI。现有 policy 只授权素材目录，不授予全局清理权限；Agent CLI、两种 MCP 和 HTTP 调用均返回 `PERMISSION_DENIED`，不能从输入扩权。

仓库根执行 `node resource-core/cli.js api storage-preview --local`。将预览中的 ID/摘要和保留天数保存为清理 JSON 后，执行 `node resource-core/cli.js api storage-clean --local --input cleanup.json`；不要凭空生成摘要或自动选择所有记录。

## 执行与中断

1. 预览计算普通文件的 SHA-256、大小和时间，页面不默认勾选；翻页清空选择。
2. 清理获取提交锁和执行锁，检查活动作业，重新核验全部选中项；摘要、时间、天数或归属变化返回 `STALE_PREVIEW`，删除前整批拒绝。
3. 先原子写入并 fsync `asset-toolbox.retention/1` 的 `retention.json`：保存最终状态摘要和批准的文件清单；之后逐个重验、删除白名单文件，只移除空报告目录，禁止递归删除。
4. 状态保留 jobId/taskId、完成摘要，新增 `resultsExpired:true` 和 cleanedAt，hasReport 为 false；results/打开报告返回 `RESULTS_EXPIRED`。同幂等请求仍返回原 jobId，不重新执行。

若部分删除失败，明细立即视为不可用，页面报告逐项失败。下一次预览仅允许继续删除原清单中内容未变的剩余文件；变化的文件留待核对。未知 retention 版本明确拒绝，不迁移。窗口关闭等待维护完成；该同步操作不提供中途取消或回滚。

## 边界与验证

预览分页仅限制返回结果，仍扫描全部记录并同步哈希；报告读取也仍整份解析。海量报告的索引/流式读取尚未实现。记录和清理标记继续占用少量空间，预览明细体积不等于净释放量。已增加资源感知队列，未增加多用户授权或 OS 沙箱；不能承诺防住同权限进程在检查与删除之间恶意替换文件。

核心 `storage.test.js` 验证保护、摘要、锁、版本、链接、恢复和幂等；MCP 跨入口测试验证 policy 拒绝；组件测试验证选择与关闭生命周期；原生 E2E 在隔离副本中验证旧记录清理、任务和输出不变。命令见[测试分层](../testing.md)。

队列升级后使用 job/5 与 data/jobs/v5，dispatch.json 为受保护控制文件；清理仍为 retention/1。排队和运行项都阻止清理，不能删除序号或幂等身份。旧 job/1–4 留原处且不扫描，见[队列](queue.md)。
