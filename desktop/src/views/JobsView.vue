<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { createJobCenter, jobModes, jobLabel } from '../core/job-center';
import { date } from '../core/model';
import { openReport } from '../core/api';
import { useWorkbench } from '../core/workbench';
const bench = useWorkbench(), center = createJobCenter();
const { rows, total, offset, next, selected, results, resultOffset, loading, error, cancelling, cancelRequested } = center;
const query = ref(''), filter = ref('all');
const resultLabels: Record<string, string> = { processed: '已处理', compressed: '已压缩', skipped: '保持原样', failed: '失败', copied: '已复制', restored: '已恢复', recoverable: '可恢复', conflict: '冲突', analyzed: '已分析' };
const resultLabel = (value: unknown) => resultLabels[String(value)] || String(value || '—');
const visible = computed(() => rows.value.filter(row => `${row.jobId} ${jobModes[row.mode] || row.mode}`.includes(query.value.trim()) && (filter.value === 'all' || (filter.value === 'queued' ? row.state?.phase === 'queued' && !row.state.done : filter.value === 'running' ? row.state && !row.state.done && row.state.phase !== 'queued' : row.state?.done))));
async function report() { if (selected.value) try { await openReport(selected.value.jobId); } catch (cause) { error.value = String(cause); } }
function task() { const id = selected.value?.state?.task?.id; if (id) { bench.selectedTaskId.value = id; bench.showTask(); } }
onMounted(center.start); onUnmounted(center.stop);
</script>

<template>
  <section class="job-center">
    <header class="commands"><h2>统一作业中心</h2><button class="button" :disabled="loading" @click="center.refresh">刷新作业</button><span class="muted">每 2 秒刷新 · 共 {{ total }} 项</span></header>
    <p class="muted">显示当前安装中桌面、CLI、MCP 和 HTTP 的作业。查看不会接管作业，关闭观察窗口不会取消其他入口的作业。</p>
    <p v-if="error" role="alert" class="callout danger selectable">{{ error }}</p>
    <div class="columns">
      <aside aria-label="作业列表">
        <div class="commands"><input v-model="query" class="input" aria-label="搜索本页作业" placeholder="搜索本页编号或操作"><select v-model="filter" class="input" aria-label="筛选本页状态"><option value="all">全部状态</option><option value="queued">排队中</option><option value="running">运行中</option><option value="done">已结束</option></select></div>
        <button v-for="row in visible" :key="row.jobId" class="job-row" :aria-current="selected?.jobId === row.jobId ? 'true' : undefined" @click="center.select(row)"><strong>{{ jobModes[row.mode] || row.mode }}</strong><span>{{ jobLabel(row.state) }}</span><small>{{ date(row.createdAt) }}</small><code>{{ row.jobId }}</code><small v-if="row.error">{{ row.error }}</small></button>
        <p v-if="!visible.length" class="muted">{{ loading ? '正在读取作业…' : '本页没有匹配的作业。' }}</p>
        <div class="commands"><button class="button" :disabled="loading || offset === 0" @click="center.changePage(Math.max(0, offset - 20))">上一页</button><button class="button" :disabled="loading || next === null" @click="center.changePage(next!)">下一页</button><span>{{ offset + 1 }} / {{ Math.max(1, total) }}</span></div>
      </aside>
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
      <p v-else class="muted">选择一个作业查看进度、结果和关联任务。</p>
    </div>
  </section>
</template>

<style scoped>
.job-center { padding: var(--s-4); overflow: auto; height: 100%; }
.commands { display: flex; align-items: center; flex-wrap: wrap; gap: var(--s-2); margin-bottom: var(--s-3); }
.columns { display: grid; grid-template-columns: minmax(240px, 32%) minmax(0, 1fr); gap: var(--s-4); }
.columns > * { min-width: 0; }
.job-row { display: grid; grid-template-columns: 1fr auto; gap: var(--s-2); width: 100%; text-align: left; padding: var(--s-3); border: 0; border-bottom: 1px solid var(--border-soft); color: var(--text); background: var(--control); }
.job-row:hover { background: var(--hover); }
.job-row[aria-current='true'] { background: var(--accent-wash); box-shadow: inset 3px 0 var(--accent); }
.job-row code, .job-row small { grid-column: 1 / -1; }
code, td, p { overflow-wrap: anywhere; white-space: normal; }
.job-detail > code { display: block; }
table { width: 100%; table-layout: fixed; margin: var(--s-3) 0; }
@media (max-width: 900px) { .columns { grid-template-columns: minmax(220px, 38%) minmax(0, 1fr); } }
</style>
