<script setup lang="ts">
// 任务页：左侧任务列表，右侧所选任务的进度、路径和后续操作。
import { computed, ref } from 'vue';
import { useWorkbench } from '../core/workbench';
import { bytes, date, folderName, sizeChange, taskStatus } from '../core/model';
import type { Task } from '../core/types';
import Icon from '../components/Icon.vue';
import Tip from '../components/Tip.vue';

const bench = useWorkbench();
const { tasks, selectedTaskId, busy } = bench;
const query = ref('');

const rows = computed(() => {
    const text = query.value.trim().toLocaleLowerCase();
    return tasks.value.filter(task => !text || `${task.source || ''}\n${task.id}`.toLocaleLowerCase().includes(text));
});
const task = computed(() => rows.value.find(item => item.id === selectedTaskId.value) ?? rows.value[0]);
const name = (item: Task) => item.source ? folderName(item.source) : item.id;
const share = (item: Task, value: number) => item.total ? `${(value / item.total) * 100}%` : '0%';
// 体积统计只覆盖已完成的文件；旧核心或读取失败的任务没有这些字段，此时整块不显示。
const sizes = computed(() => {
    const value = task.value;
    if (!value || value.originalBytes === undefined || value.outputBytes === undefined) return undefined;
    const saved = value.savedBytes ?? value.originalBytes - value.outputBytes;
    const percent = value.originalBytes ? Math.abs(saved) / value.originalBytes * 100 : 0;
    return { original: value.originalBytes, output: value.outputBytes, saved, total: value.totalBytes,
        ratio: saved && value.originalBytes ? `${saved > 0 ? '−' : '+'}${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%` : '', tone: saved > 0 ? 'ok' : saved < 0 ? 'warn' : '' };
});
// 详情里的三个位置；覆盖原文件时“写入”就是来源文件夹。
const places = computed(() => task.value ? [
    { label: '来源', path: task.value.source, text: task.value.source || '—' },
    { label: '写入', path: task.value.outputDir || task.value.source, text: task.value.outputDir || '覆盖原文件', plain: !task.value.outputDir },
    { label: '备份', path: task.value.backupSession, text: task.value.backupSession || '未备份', plain: !task.value.backupSession },
] : []);
</script>

<template>
  <div class="tasks">
    <aside class="list" aria-label="任务列表">
      <div class="tools">
        <input v-model="query" class="input" type="search" aria-label="搜索任务" placeholder="搜索文件夹或任务编号">
        <Tip text="刷新任务列表"><button type="button" class="button icon-only" aria-label="刷新任务列表" :disabled="busy" @click="bench.refreshTasks().catch(bench.fail)"><Icon name="refresh" /></button></Tip>
      </div>
      <ul v-if="rows.length" class="rows">
        <li v-for="item in rows" :key="item.id">
          <button type="button" class="row" :aria-current="task?.id === item.id ? 'true' : undefined" @click="selectedTaskId = item.id">
            <span class="row-head"><span class="row-name">{{ name(item) }}</span><span class="tone small" :class="taskStatus(item).tone">{{ taskStatus(item).label }}</span></span>
            <span class="small muted">{{ date(item.createdAt) }}，{{ item.total }} 个文件</span>
            <span class="bar" aria-hidden="true"><span class="done" :style="{ width: share(item, item.completed) }"></span><span class="failed" :style="{ width: share(item, item.failed) }"></span></span>
          </button>
        </li>
      </ul>
      <p v-else class="empty">{{ tasks.length ? '没有匹配的任务。请更换文件夹名或任务编号。' : '还没有任务。在“处理”页开始处理后，进度会保存在这里。' }}</p>
    </aside>

    <section class="detail">
      <article v-if="task" class="sheet">
        <header class="head">
          <div class="heading">
            <h2>{{ name(task) }}</h2>
            <p class="badge" :class="taskStatus(task).tone">{{ taskStatus(task).label }}</p>
          </div>
          <div class="actions">
            <Tip text="只处理还没完成的文件"><button type="button" class="button" :class="{ primary: task.canResume }" :disabled="busy || !task.canResume" @click="bench.continueTask(task, 'resume')">继续未完成</button></Tip>
            <Tip text="重新处理上次失败的文件"><button type="button" class="button" :disabled="busy || !task.canRetry" @click="bench.continueTask(task, 'retry')">重试失败项</button></Tip>
          </div>
        </header>
        <p v-if="task.error" class="callout danger selectable"><Icon name="alert" class="tone danger" /><span>{{ task.error }}</span></p>

        <section class="group progress" aria-label="处理进度">
          <div class="bar large" aria-hidden="true"><span class="done" :style="{ width: share(task, task.completed) }"></span><span class="failed" :style="{ width: share(task, task.failed) }"></span></div>
          <dl class="legend">
            <div><dt><span class="key done"></span>已完成</dt><dd>{{ task.completed }}</dd></div>
            <div><dt><span class="key pending"></span>待处理</dt><dd>{{ task.pending }}</dd></div>
            <div><dt><span class="key failed"></span>失败</dt><dd>{{ task.failed }}</dd></div>
            <div><dt>总计</dt><dd>{{ task.total }}</dd></div>
          </dl>
          <p class="muted small">继续和重试使用创建任务时的步骤和参数，已成功的文件会自动跳过。</p>
        </section>

        <section v-if="sizes" class="group" aria-label="体积">
          <h3>体积</h3>
          <dl class="legend sizes">
            <div><dt>处理前</dt><dd>{{ bytes(sizes.original) }}</dd></div>
            <div><dt>处理后</dt><dd>{{ bytes(sizes.output) }}</dd></div>
            <div><dt>体积变化</dt><dd :class="sizes.tone ? `tone ${sizes.tone}` : ''">{{ sizeChange(sizes.saved) }}<small v-if="sizes.ratio">{{ sizes.ratio }}</small></dd></div>
          </dl>
          <p class="muted small">只统计已完成的 {{ task.completed }} 个文件{{ sizes.total !== undefined ? `；任务清单共 ${bytes(sizes.total)}（扫描时）` : '' }}。之后恢复原文件不会改变这里的数字。</p>
        </section>

        <section class="group">
          <h3>详情</h3>
          <dl class="facts">
            <template v-for="place in places" :key="place.label">
              <dt>{{ place.label }}</dt>
              <dd class="place">
                <span :class="{ path: !place.plain }">{{ place.text }}</span>
                <Tip v-if="place.path" text="在资源管理器中打开"><button type="button" class="button quiet small icon-only" :aria-label="`打开${place.label}文件夹`" @click="bench.revealFolder(place.path)"><Icon name="folder" :size="14" /></button></Tip>
              </dd>
            </template>
            <dt>创建时间</dt><dd>{{ date(task.createdAt) }}</dd>
            <dt>任务编号</dt><dd class="path">{{ task.id }}</dd>
          </dl>
        </section>

        <section class="group">
          <h3>备份与恢复</h3>
          <p class="muted">已备份 {{ task.backupCount || 0 }} 个文件，已恢复 {{ task.restored || 0 }} 个，恢复失败 {{ task.restoreFailed || 0 }} 个。</p>
          <div class="actions">
            <button type="button" class="button" :disabled="busy || !task.backupCount" @click="bench.checkRestore({ kind: 'task', taskId: task.id })">检查备份</button>
            <button type="button" class="button" :disabled="busy || !task.canContinueRestore" @click="bench.checkRestore({ kind: 'task', taskId: task.id }, 'continue')">继续上次恢复</button>
            <button type="button" class="button" :disabled="busy || !task.canRetryRestore" @click="bench.checkRestore({ kind: 'task', taskId: task.id }, 'retry')">重试恢复失败项</button>
          </div>
        </section>
      </article>
      <div v-else-if="!tasks.length" class="sheet empty-detail">
        <h2>任务会记录每个文件的进度</h2>
        <p class="muted">处理中途取消或关闭窗口后，可以在这里继续剩余文件；启用了备份的任务还能检查并恢复原文件。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.tasks { display: grid; grid-template-columns: var(--list-width) minmax(0, 1fr); min-height: 0; }
.list { display: flex; flex-direction: column; min-height: 0; background: var(--pane); border-right: 1px solid var(--border-soft); }
.tools { display: flex; gap: var(--s-1); padding: var(--s-2); }
.rows { list-style: none; margin: 0; padding: 0 var(--s-2) var(--s-4); overflow-y: auto; }
.row { display: grid; gap: 1px; width: 100%; margin-bottom: 1px; padding: 6px var(--s-2) var(--s-2); border: 0; border-radius: var(--r-control); background: none; text-align: left; }
.row:hover { background: var(--hover); }
.row[aria-current='true'] { background: var(--accent-wash); }
.row:focus-visible { outline-offset: -2px; }
.row-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-2); min-width: 0; }
.row-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-head .tone { flex: none; }
.empty { padding: var(--s-2) var(--s-4); color: var(--text-2); }

/* 进度条按完成 / 失败 / 待处理的比例分段 */
.bar { display: flex; height: 3px; margin-top: var(--s-1); border-radius: 2px; background: var(--pressed); overflow: hidden; }
.bar.large { height: 8px; margin: 0; border-radius: 4px; }
.bar .done, .key.done { background: var(--ok); }
.bar .failed, .key.failed { background: var(--danger); }
.key.pending { background: var(--border); }

.detail { min-height: 0; overflow-y: auto; }
.sheet { display: grid; gap: var(--s-3); max-width: var(--measure); padding: var(--pane-padding) var(--pane-padding) var(--s-7); }
.head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); flex-wrap: wrap; }
.heading { display: flex; align-items: center; gap: var(--s-3); min-width: 0; }
h2 { overflow-wrap: anywhere; }
.legend { display: flex; gap: var(--s-6); flex-wrap: wrap; margin: 0; }
.legend dt { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font-size: var(--t-small); }
.legend dd { margin: 0; font-size: var(--t-figure); font-weight: 600; line-height: 1.3; }
.key { width: 8px; height: 8px; border-radius: 2px; }
.sizes dd small { margin-left: var(--s-2); font-size: var(--t-small); font-weight: 400; }
.place { display: flex; align-items: center; gap: var(--s-1); min-width: 0; min-height: var(--control-small); }
.place > span { min-width: 0; }
.place .button { flex: none; margin: -2px 0; color: var(--text-2); }
.facts { align-items: center; }
.actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.empty-detail { align-content: start; gap: var(--s-1); }
</style>
