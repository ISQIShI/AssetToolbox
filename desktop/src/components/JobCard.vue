<script setup lang="ts">
import { jobLabel, jobModes, type JobRow } from '../core/job-center';
import { date } from '../core/model';
defineProps<{ row: JobRow; selected?: boolean }>();
defineEmits<{ select: [row: JobRow] }>();
</script>

<template>
  <button class="job-row" :aria-current="selected ? 'true' : undefined" @click="$emit('select', row)">
    <span class="card-heading"><strong>{{ jobModes[row.mode] || row.mode }}</strong><span class="state" :data-active="row.state && !row.state.done">{{ jobLabel(row.state) }}</span></span>
    <span class="subject" v-if="row.state?.task?.source">{{ row.state.task.source }}</span>
    <code :title="row.jobId">{{ row.jobId }}</code>
    <template v-if="row.state && !row.state.done && row.state.phase !== 'queued'">
      <progress :value="row.state.total > 0 ? row.state.processed : undefined" :max="row.state.total || 1" aria-label="作业进度" />
      <span class="card-foot"><span class="subject">{{ row.state.current || '正在准备资源…' }}</span><span>{{ row.state.processed }} / {{ row.state.total }}</span></span>
    </template>
    <span v-else-if="row.state?.phase === 'queued' && !row.state.done" class="card-foot">{{ row.state.message || '等待派发' }}</span>
    <span v-else class="card-foot"><span>{{ date(row.createdAt) }}</span><span v-if="row.state">{{ row.state.processed }} 个文件</span></span>
    <span v-if="row.error" class="card-error">{{ row.error }}</span>
  </button>
</template>

<style scoped>
.job-row { width: 100%; min-width: 0; display: grid; gap: var(--s-2); padding: var(--s-3); text-align: left; border: 1px solid var(--border-soft); border-radius: var(--r-panel); background: var(--control); color: var(--text); }
.job-row:hover { border-color: var(--border); background: var(--hover); }
.job-row[aria-current='true'] { border-color: var(--accent); background: var(--accent-wash); box-shadow: inset 3px 0 var(--accent); }
.job-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.card-heading, .card-foot { display: flex; justify-content: space-between; align-items: center; gap: var(--s-2); min-width: 0; }
.state { flex-shrink: 0; font-size: var(--t-small); color: var(--text-2); }
.state[data-active='true'] { color: var(--accent); }
.subject, code { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; min-width: 0; }
code, .card-foot { color: var(--text-2); font-size: var(--t-small); }
.card-foot > :last-child { flex-shrink: 0; }
.card-error { color: var(--danger); overflow-wrap: anywhere; }
progress { width: 100%; height: 4px; accent-color: var(--accent); border: 0; }
progress::-webkit-progress-bar { background: var(--border-soft); border-radius: var(--r-control); }
progress::-webkit-progress-value { background: var(--accent); border-radius: var(--r-control); }
</style>
