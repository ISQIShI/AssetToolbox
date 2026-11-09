<script setup lang="ts">
// 作业栏：固定在窗口底部，在任何页面都能看到进度并取消。
// 进度条就是作业栏的上边线；完成后保留结果，直到用户关闭。
import { computed } from 'vue';
import { useWorkbench } from '../core/workbench';
import { bytes, elapsed, sizeChange } from '../core/model';

const bench = useWorkbench();
const { job, closing } = bench;

const phases: Record<string, string> = { starting: '正在启动', scanning: '正在扫描', checking: '正在检查', processing: '正在处理', restoring: '正在恢复', downloading: '正在下载', verifying: '正在校验', installing: '正在安装', finished: '正在收尾' };
const state = computed(() => job.value!.state);
const running = computed(() => !state.value.done);
const percent = computed(() => state.value.total ? Math.min(100, Math.round(state.value.processed / state.value.total * 100)) : 0);
const restoring = computed(() => state.value.summary?.restored !== undefined);
const status = computed(() => {
    const value = state.value;
    const boundary = job.value!.kind === 'dependency' ? '等待依赖检查结束' : '等待当前文件结束';
    if (closing.value) return { label: `正在安全退出，${boundary}`, tone: 'warn' };
    if (!value.done) return job.value!.cancelRequested ? { label: `已请求取消，${boundary}`, tone: 'warn' } : { label: phases[value.phase] || value.phase, tone: 'neutral' };
    if (value.cancelled) return { label: '已取消', tone: 'warn' };
    if (value.error) return { label: '未完成', tone: 'danger' };
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
  <section v-if="job" class="dock" :class="{ running }" :data-job-id="job.id" :data-state="running ? 'running' : 'done'" role="status" aria-live="polite" :aria-label="`${job.title}：${status.label}`">
    <div class="meter" :class="{ indeterminate: running && !state.total }" aria-hidden="true">
      <span :style="{ width: running ? `${percent}%` : '100%' }"></span>
    </div>

    <div class="row">
      <div class="title">
        <h2>{{ job.title }}</h2>
        <p class="tone" :class="status.tone">{{ status.label }}</p>
      </div>

      <p v-if="running" class="progress">
        <span class="count">{{ state.processed }} / {{ state.total || '…' }}</span>
        <span class="muted">{{ elapsed(state.elapsedSeconds) }}</span>
      </p>
      <dl v-else-if="figures.length" class="figures">
        <div v-for="item in figures" :key="item.label"><dt>{{ item.label }}</dt><dd :class="item.tone ? `tone ${item.tone}` : ''">{{ item.value }}</dd></div>
      </dl>

      <div class="actions">
        <button v-if="running" type="button" class="button" :disabled="job.cancelRequested" @click="bench.cancelJob()">取消</button>
        <template v-else>
          <button v-if="state.reportDirectory" type="button" class="button" @click="bench.openJobReport()">打开报告</button>
          <button v-if="state.task" type="button" class="button" @click="bench.showTask(state.task); bench.dismissJob()">查看任务</button>
          <button type="button" class="button quiet" aria-label="关闭作业结果" @click="bench.dismissJob()">关闭</button>
        </template>
      </div>
    </div>

    <p v-if="running && state.current" class="current path">{{ state.current }}</p>
    <p v-if="running && job.kind === 'dependency' && state.message" class="small muted">{{ state.message }}</p>
    <div v-if="!running && (state.error || notes.length || state.cancelled || state.message)" class="details">
      <p v-if="state.error" class="tone danger">{{ state.error }}</p>
      <p v-for="note in notes" :key="note" class="tone warn">{{ note }}</p>
      <p v-if="state.cancelled && job.kind !== 'dependency'" class="muted">{{ state.task ? '已完成的文件已记录，可在“任务”页继续剩余文件。' : '已停止。可重新扫描或检查后再继续。' }}</p>
      <p v-if="state.message" class="muted">{{ state.message }}</p>
    </div>
  </section>
</template>

<style scoped>
.dock {
  flex: none;
  position: relative;
  display: grid;
  gap: var(--s-1);
  max-height: 40vh;
  overflow-y: auto;
  padding: var(--s-3) var(--s-5);
  background: var(--paper);
  border-top: 1px solid var(--rule);
}
.meter { position: absolute; inset: -1px 0 auto; height: 3px; background: var(--rule-soft); overflow: hidden; }
.meter span { display: block; height: 100%; background: var(--ink); transition: width 0.25s linear; }
.dock:not(.running) .meter span { background: var(--rule); }
.meter.indeterminate span { width: 30% !important; animation: sweep 1.4s ease-in-out infinite; }
@keyframes sweep { from { transform: translateX(-100%); } to { transform: translateX(340%); } }

.row { display: flex; align-items: center; gap: var(--s-5); flex-wrap: wrap; }
.title { display: flex; align-items: baseline; gap: var(--s-1) var(--s-3); flex-wrap: wrap; min-width: 0; }
h2 { font-size: var(--t-title); }
.progress { display: flex; gap: var(--s-4); align-items: baseline; }
.count { font-size: var(--t-title); font-weight: 500; }
.figures { display: flex; flex-wrap: wrap; gap: var(--s-1) var(--s-5); margin: 0; }
.figures > div { display: flex; gap: var(--s-2); align-items: baseline; }
.figures dt { color: var(--ink-2); font-size: var(--t-small); }
.figures dd { margin: 0; font-weight: 500; }
.actions { display: flex; gap: var(--s-2); margin-left: auto; }
.current { color: var(--ink-2); font-size: var(--t-small); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.details { display: grid; gap: var(--s-1); }
@media (max-width: 560px) {
  .dock { padding: var(--s-3) var(--s-4); }
  .row { gap: var(--s-3); }
  .title { width: 100%; }
  .actions { flex-wrap: wrap; }
}
</style>
