<script setup lang="ts">
// 作业栏：默认停靠在工作区底部，在任何页面都能看到进度并取消。完成后保留结果，直到用户关闭。
// 处理页把它以 panel 变体放进右侧概览栏：同一份状态与命令，纵向排布并放大进度和结果数字。
import { computed } from 'vue';
import { useWorkbench } from '../core/workbench';
import { bytes, elapsed, sizeChange } from '../core/model';
import Icon from './Icon.vue';
import Tip from './Tip.vue';
import AudioResults from './AudioResults.vue';

const props = defineProps<{ variant?: 'bar' | 'panel' }>();
const panel = computed(() => props.variant === 'panel');
const bench = useWorkbench();
const { job, closing } = bench;

const phases: Record<string, string> = { queued: '排队等待', starting: '正在启动', scanning: '正在扫描', checking: '正在检查', processing: '正在处理', restoring: '正在恢复', downloading: '正在下载', verifying: '正在校验', installing: '正在安装', finished: '正在收尾' };
const state = computed(() => job.value!.state);
const running = computed(() => !state.value.done);
const percent = computed(() => state.value.total ? Math.min(100, Math.round(state.value.processed / state.value.total * 100)) : 0);
const restoring = computed(() => state.value.summary?.restored !== undefined);
const status = computed(() => {
    const value = state.value;
    const boundary = job.value!.kind === 'dependency' ? '等待依赖检查结束' : '等待当前文件结束';
    if (job.value!.statusError) return { label: '暂时无法取得作业状态', tone: 'warn' };
    if (closing.value) return { label: `正在安全退出，${boundary}`, tone: 'warn' };
    if (!value.done) return job.value!.cancelRequested ? { label: `已请求取消，${boundary}`, tone: 'warn' } : { label: phases[value.phase] || value.phase, tone: 'neutral' };
    if (value.cancelled) return { label: '已取消', tone: 'warn' };
    if (value.error || value.exitCode) return { label: '未完成', tone: 'danger' };
    if (value.summary?.failed) return { label: `完成，${value.summary.failed} 个失败`, tone: 'danger' };
    return { label: '已完成', tone: 'ok' };
});
const figures = computed(() => {
    const summary = state.value.summary;
    if (!summary) return [];
    const list: { label: string; value: string; tone?: string }[] = restoring.value
        ? [{ label: '已恢复', value: String(summary.restored ?? 0) }, { label: '恢复体积', value: bytes(summary.restoredBytes) }]
        : [{ label: '已处理', value: String(summary.processed ?? 0) }, { label: '体积变化', value: sizeChange(summary.savedBytes), tone: (summary.savedBytes || 0) > 0 ? 'ok' : (summary.savedBytes || 0) < 0 ? 'warn' : '' }];
    list.push({ label: '保持原样', value: String(summary.skipped ?? 0) });
    list.push({ label: '失败', value: String(summary.failed ?? 0), tone: summary.failed ? 'danger' : '' });
    if (summary.copied) list.push({ label: '原样复制', value: String(summary.copied) });
    if (summary.backedUp) list.push({ label: '已备份', value: String(summary.backedUp) });
    return list;
});
const notes = computed(() => [state.value.reportWarning, ...(state.value.recoveryWarnings || [])].filter(Boolean) as string[]);
</script>

<template>
  <section v-if="job" class="dock" :class="{ running, panel }" :data-job-id="job.id" :data-state="running ? 'running' : 'done'" role="status" aria-live="polite" :aria-label="`${job.title}：${status.label}`">
    <div class="row">
      <div class="title">
        <Icon v-if="!running" :name="status.tone === 'ok' ? 'ok' : 'alert'" class="tone" :class="status.tone" />
        <h2>{{ job.title }}</h2>
        <p class="tone" :class="status.tone">{{ status.label }}</p>
      </div>

      <div v-if="running" class="progress">
        <span v-if="panel" class="percent">{{ state.total ? `${percent}%` : '…' }}</span>
        <div class="meter" :class="{ indeterminate: !state.total }" aria-hidden="true"><span :style="{ width: `${percent}%` }"></span></div>
        <span class="count">{{ state.processed }} / {{ state.total || '…' }}</span>
        <span class="muted elapsed">{{ elapsed(state.elapsedSeconds) }}</span>
      </div>
      <dl v-else-if="figures.length" class="figures">
        <div v-for="item in figures" :key="item.label"><dt>{{ item.label }}</dt><dd :class="item.tone ? `tone ${item.tone}` : ''">{{ item.value }}</dd></div>
      </dl>

      <div class="actions">
        <button v-if="running" type="button" class="button" :disabled="job.cancelRequested" @click="bench.cancelJob()">取消</button>
        <template v-else>
          <button v-if="job.resultError" type="button" class="button" :disabled="job.readingResults" @click="bench.readJobResults()">重新读取结果</button>
          <button v-if="state.hasReport" type="button" class="button" @click="bench.openJobReport()"><Icon name="report" />打开报告</button>
          <button v-if="state.task" type="button" class="button" @click="bench.showTask(state.task); bench.dismissJob()">查看任务</button>
          <Tip text="关闭" side="top"><button type="button" class="button quiet icon-only" aria-label="关闭作业结果" @click="bench.dismissJob()"><Icon name="close" /></button></Tip>
        </template>
      </div>
    </div>

    <p v-if="job.statusError" class="small tone warn selectable">{{ closing ? '正在等待核心确认后退出。' : '' }}正在自动重试，进度保留上次读数。{{ job.statusError }}</p>
    <p v-if="job.resultError" class="small tone warn selectable">暂时无法读取作业结果。{{ job.resultError }}</p>
    <AudioResults v-if="!running && state.audioResults?.length" :results="state.audioResults" :total="state.audioResultCount || state.audioResults.length" />
    <p v-if="state.resultsExpired" class="small muted">报告与明细已清理；任务和备份保留。</p>
    <p v-if="running && state.current" class="current path">{{ state.current }}</p>
    <p v-if="running && job.kind === 'dependency' && state.message" class="small muted">{{ state.message }}</p>
    <div v-if="!running && (state.error || notes.length || state.cancelled || state.message)" class="details selectable">
      <p v-if="state.error" class="tone danger">{{ state.error }}</p>
      <p v-for="note in notes" :key="note" class="tone warn">{{ note }}</p>
      <p v-if="state.cancelled && job.kind !== 'dependency'" class="muted">{{ state.task ? '已完成的文件已记录，可在“活动”页的任务里继续剩余文件。' : '已停止。可重新扫描或检查后再继续。' }}</p>
      <p v-if="state.message" class="muted">{{ state.message }}</p>
    </div>
  </section>
</template>

<style scoped>
.dock {
  flex: none;
  display: grid;
  gap: var(--s-1);
  max-height: 40vh;
  overflow-y: auto;
  padding: var(--s-2) var(--s-3) var(--s-2) var(--s-4);
  background: var(--pane);
  border-top: 1px solid var(--border-soft);
}
.row { display: flex; align-items: center; gap: var(--s-2) var(--s-5); flex-wrap: wrap; min-height: var(--control-height); }
.title { display: flex; align-items: center; gap: var(--s-2); min-width: 0; }
h2 { font-size: var(--t-body); white-space: nowrap; }

.progress { flex: 1 1 240px; display: flex; align-items: center; gap: var(--s-3); min-width: 0; }
.progress .meter { flex: 1; min-width: 80px; }
.meter span { transition: width 0.25s linear; }
.meter.indeterminate span { width: 30% !important; animation: sweep 1.4s ease-in-out infinite; }
@keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
.count { font-weight: 600; white-space: nowrap; }
.elapsed { white-space: nowrap; }

.figures { flex: 1 1 240px; display: flex; flex-wrap: wrap; gap: 2px var(--s-5); margin: 0; }
.figures > div { display: flex; gap: 6px; align-items: baseline; }
.figures dt { color: var(--text-2); font-size: var(--t-small); }
.figures dd { margin: 0; font-weight: 600; }
.actions { display: flex; gap: var(--s-1); margin-left: auto; }
.current { color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: default; }
.details { display: grid; gap: 2px; padding-bottom: var(--s-1); }

/* panel 变体：处理页右侧概览栏中的作业卡片。窄窗口里概览栏移到下方，沿用上面的横向布局 */
.dock.panel { border-top: 0; background: none; padding-left: 0; padding-right: 0; }
@media (min-width: 1041px) {
  .dock.panel { max-height: none; overflow: visible; gap: var(--s-2); padding: var(--s-4); border-top: 0; border-radius: var(--r-panel); background: var(--control); box-shadow: var(--shadow-card); animation: rise 0.16s ease-out; }
  .dock.panel.running { box-shadow: 0 0 0 1px var(--accent), var(--shadow-card); }
  .panel .row { display: grid; gap: var(--s-3); }
  .panel .title { flex-wrap: wrap; gap: 2px var(--s-2); }
  .panel h2 { font-size: var(--t-title); letter-spacing: 0; }
  .panel .progress { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: var(--s-1) var(--s-3); }
  .panel .percent { grid-column: 1 / -1; font-size: 28px; font-weight: 600; line-height: 1.1; }
  .panel .progress .meter { grid-column: 1 / -1; height: 6px; border-radius: 3px; }
  .panel .figures { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3) var(--s-4); }
  .panel .figures > div { display: grid; gap: 0; }
  .panel .figures dd { font-size: var(--t-title); }
  /* 前两项（已处理 / 体积变化）是结果的重点，放大显示 */
  .panel .figures > div:nth-child(-n + 2) dd { font-size: var(--t-figure); line-height: 1.3; }
  .panel .actions { margin-left: 0; flex-wrap: wrap; }
  .panel .actions .icon-only { margin-left: auto; }
}
</style>
