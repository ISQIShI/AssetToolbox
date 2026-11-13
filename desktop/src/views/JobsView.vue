<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { createJobCenter, jobModes, jobLabel } from '../core/job-center';
import JobCard from '../components/JobCard.vue';
import { openReport } from '../core/api';
import { useWorkbench } from '../core/workbench';
const bench = useWorkbench(), center = createJobCenter();
const { rows, total, offset, next, selected, results, resultOffset, loading, error, cancelling, cancelRequested, queue, saving } = center;
const query = ref(''), filter = ref('all');
const resultLabels: Record<string, string> = { processed: '已处理', compressed: '已压缩', skipped: '保持原样', failed: '失败', copied: '已复制', restored: '已恢复', recoverable: '可恢复', conflict: '冲突', analyzed: '已分析' };
const resultLabel = (value: unknown) => resultLabels[String(value)] || String(value || '—');
const limit = ref(2);
watch(() => queue.value?.maxConcurrent, value => { if (value !== undefined) limit.value = value; });
const activeIds = computed(() => new Set([...(queue.value?.slots.flatMap(slot => slot.job ? [slot.job.jobId] : []) || []), ...(queue.value?.waiting.map(row => row.jobId) || [])]));
const visible = computed(() => rows.value.filter(row => !activeIds.value.has(row.jobId) && `${row.jobId} ${jobModes[row.mode] || row.mode}`.includes(query.value.trim()) && (filter.value === 'all' || (filter.value === 'failed' ? row.state?.done && (row.state.error || row.state.exitCode) && !row.state.cancelled : row.state?.cancelled))));
async function report() { if (selected.value) try { await openReport(selected.value.jobId); } catch (cause) { error.value = String(cause); } }
function task() { const id = selected.value?.state?.task?.id; if (id) { bench.selectedTaskId.value = id; bench.showTask(); } }
onMounted(center.start); onUnmounted(center.stop);
</script>

<template>
  <section class="job-center">
    <header class="center-header">
      <div><h2>统一作业中心</h2><p class="muted">查看各入口的作业，保持各自的运行会话。</p></div>
      <div class="commands"><span v-if="queue" class="summary">{{ queue.runningCount }} 运行 · {{ queue.waitingCount }} 等待</span><button class="button" :disabled="loading" @click="center.refresh">刷新作业</button></div>
    </header>
    <p v-if="error" role="alert" class="callout danger selectable">{{ error }}</p>
    <div class="columns">
      <div class="queue-board">
        <section aria-label="执行槽位">
          <div class="section-title"><h3>执行槽位</h3><span class="muted">每 2 秒刷新</span></div>
          <div class="budget-bar" v-if="queue">
            <label>并行数量 <input class="input" type="number" v-model.number="limit" :min="queue.minConcurrent" :max="queue.maxAllowedConcurrent" :disabled="!queue.canConfigure || saving" aria-label="并行数量"></label>
            <button class="button" :disabled="!queue.canConfigure || saving || loading || limit === queue.maxConcurrent || !Number.isInteger(limit) || limit < 1 || limit > queue.maxAllowedConcurrent" @click="center.configure(limit)">应用</button>
            <button class="button" :disabled="!queue.canConfigure || saving || loading || queue.maxConcurrent === queue.recommendedConcurrent" @click="center.configure(queue.recommendedConcurrent)">使用建议值（{{ queue.recommendedConcurrent }}）</button>
            <small class="muted">{{ queue.availableProcessors }} 个可用逻辑处理器。编码器也会使用多线程，建议值为保守估算。{{ queue.canConfigure ? '空闲时可调整。' : '队列空闲后可调整。' }}</small>
          </div>
          <div v-if="queue" class="slots">
            <div v-for="slot in queue.slots" :key="slot.slot" class="slot" :data-slot="slot.slot" :data-occupied="slot.occupied">
              <div class="slot-label"><span>槽位</span><strong>{{ String(slot.slot).padStart(2, '0') }}</strong></div>
              <JobCard v-if="slot.job" :row="slot.job" :selected="selected?.jobId === slot.job.jobId" @select="center.select" />
              <div v-else class="empty-slot"><span class="slot-dot" :class="{ occupied: slot.occupied }"></span><span>{{ slot.occupied ? '已占用 · 当前上下文无法查看作业' : '空闲，等待可执行作业' }}</span></div>
            </div>
          </div>
          <p v-else class="muted">执行槽位尚未读取，点击刷新重试。</p>
        </section>
        <section v-if="queue?.waiting.length" aria-label="等待队列" class="waiting-section">
          <div class="section-title"><h3>等待队列 <span>{{ queue.waitingCount }}</span></h3><small class="muted">冲突项按登记顺序等待</small></div>
          <div class="waiting-cards"><JobCard v-for="row in queue.waiting" :key="row.jobId" :row="row" :selected="selected?.jobId === row.jobId" @select="center.select" /></div>
        </section>
        <section aria-label="作业记录" class="history-section">
          <div class="section-title"><h3>作业记录</h3><span class="muted">共 {{ total }} 项 · 当前活动项见上方</span></div>
          <div class="commands"><input v-model="query" class="input" aria-label="搜索本页作业" placeholder="搜索本页编号或操作"><select v-model="filter" class="input" aria-label="筛选本页状态"><option value="all">全部记录</option><option value="failed">失败 / 中断</option><option value="cancelled">已取消</option></select></div>
          <div class="history-cards"><JobCard v-for="row in visible" :key="row.jobId" :row="row" :selected="selected?.jobId === row.jobId" @select="center.select" /></div>
          <p v-if="!visible.length" class="muted">{{ loading ? '正在读取作业…' : '本页没有其他匹配记录。' }}</p>
          <div class="commands pagination"><button class="button" :disabled="loading || offset === 0" @click="center.changePage(Math.max(0, offset - 20))">上一页</button><span class="muted">{{ total ? offset + 1 : 0 }}–{{ Math.min(offset + 20, total) }} / {{ total }}</span><button class="button" :disabled="loading || next === null" @click="center.changePage(next!)">下一页</button></div>
        </section>
      </div>
      <article v-if="selected" class="job-detail">
        <header class="commands"><h2>{{ jobModes[selected.mode] || selected.mode }}</h2><span>{{ jobLabel(selected.state) }}</span></header>
        <code class="selectable">{{ selected.jobId }}</code>
        <p v-if="selected.state?.phase === 'queued' && !selected.state.done" role="status">登记顺位 {{ selected.state.queuePosition }}（含执行中作业，不代表启动顺序）。{{ selected.state.message }}；执行槽位 {{ selected.state.runningCount }} / {{ selected.state.concurrencyLimit }}，可随时取消等待。</p>
        <p v-if="selected.state">进度：{{ selected.state.processed }} / {{ selected.state.total }}<span v-if="selected.state.current"> · {{ selected.state.current }}</span></p>
        <p v-if="selected.state?.error || selected.error" class="callout danger selectable">{{ selected.state?.error || selected.error }}</p>
        <p v-if="selected.state?.resultsExpired" class="callout">报告与明细已清理，作业身份与任务记录仍保留。</p>
        <div class="commands"><button class="button danger" :disabled="!selected.state || selected.state.done || cancelling || cancelRequested === selected.jobId" @click="center.cancel">取消此作业</button><button class="button" :disabled="!selected.state?.hasReport" @click="report">打开此作业报告</button><button class="button" :disabled="!selected.state?.task?.id" @click="task">查看素材任务</button></div>
        <p v-if="cancelRequested === selected.jobId && !selected.state?.done" role="status">已请求取消，等待当前文件结束。</p>
        <template v-if="results">
          <h3>逐文件结果（{{ results.total }} 项）</h3>
          <table><thead><tr><th>文件</th><th>状态</th><th>说明</th></tr></thead><tbody><tr v-for="(row, i) in results.items" :key="i"><td class="selectable">{{ row.path }}</td><td>{{ resultLabel(row.status || row.state) }}</td><td>{{ row.message || row.reason }}</td></tr></tbody></table>
          <div class="commands"><button class="button" :disabled="resultOffset === 0" @click="center.loadResults(Math.max(0, resultOffset - 50))">上一页结果</button><button class="button" :disabled="results.nextOffset === null" @click="center.loadResults(results.nextOffset!)">下一页结果</button></div>
        </template>
        <p v-else-if="selected.state?.done && !selected.state.resultsExpired" class="muted">此作业无可显示的文件明细，或明细正在读取。</p>
      </article>
      <aside v-else class="detail-placeholder"><strong>作业详情</strong><p>选择槽位或队列中的卡片，查看进度与逐文件结果。</p><p>仅观察不会接管作业，关闭窗口不取消其他入口作业。</p></aside>
    </div>
  </section>
</template>

<style scoped>
.job-center { padding: var(--s-4); overflow: hidden; height: 100%; display: flex; flex-direction: column; }
.center-header, .section-title { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.center-header { margin-bottom: var(--s-4); flex-shrink: 0; }
.center-header p { margin: var(--s-1) 0 0; font-size: var(--t-small); }
.summary { color: var(--accent); white-space: nowrap; }
.commands, .budget-bar { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); }
.commands { margin-bottom: var(--s-3); }
.center-header .commands { margin: 0; }
.columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 34%); gap: var(--s-4); align-items: start; overflow: auto; min-height: 0; flex: 1; }
.columns > *, .queue-board { min-width: 0; }
.section-title { margin-bottom: var(--s-3); }
.section-title h3 { margin: 0; }
.section-title h3 span { color: var(--text-3); font-weight: normal; margin-left: var(--s-2); }
.budget-bar { padding: var(--s-3); background: var(--pane); border-radius: var(--r-panel); margin-bottom: var(--s-3); }
.budget-bar label { display: flex; align-items: center; gap: var(--s-2); }
.budget-bar input { width: 64px; }
.budget-bar small { flex-basis: 100%; }
.slots { display: grid; gap: var(--s-2); }
.slot { display: grid; grid-template-columns: 48px minmax(0, 1fr); align-items: stretch; gap: var(--s-2); }
.slot-label { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--s-1); color: var(--text-3); font-size: var(--t-small); }
.slot-label strong { font-family: var(--font-mono); font-size: var(--t-figure); font-weight: normal; }
.slot[data-occupied='true'] .slot-label { color: var(--accent); }
.empty-slot { display: flex; align-items: center; gap: var(--s-2); min-height: 76px; padding: var(--s-3); border: 1px dashed var(--border); border-radius: var(--r-panel); color: var(--text-3); }
.slot-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--border); flex-shrink: 0; }
.slot-dot.occupied { background: var(--warn); }
.waiting-section, .history-section { margin-top: var(--s-5); padding-top: var(--s-4); border-top: 1px solid var(--border-soft); }
.waiting-cards, .history-cards { display: grid; gap: var(--s-2); }
.history-section .commands .input { flex: 1 1 180px; width: 0; min-width: 130px; }
.pagination { margin-top: var(--s-3); justify-content: space-between; }
.job-detail, .detail-placeholder { position: sticky; top: 0; padding: var(--s-4); background: var(--control); border: 1px solid var(--border-soft); border-radius: var(--r-panel); max-height: calc(100vh - 140px); overflow: auto; }
.detail-placeholder { color: var(--text-2); }
.job-detail > code { display: block; font-size: var(--t-small); color: var(--text-2); }
code, td, p { overflow-wrap: anywhere; white-space: normal; }
table { width: 100%; table-layout: fixed; margin: var(--s-3) 0; }
@media (max-width: 900px) { .columns { grid-template-columns: minmax(0, 1fr) 280px; } .center-header { align-items: start; flex-wrap: wrap; } }
</style>
