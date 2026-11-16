<script setup lang="ts">
// 概览栏：处理页右侧常驻。自上而下是当前作业（进度或结果）、扫描数字、各资源格式的步骤数与文件数。
// 扫描前也显示“会识别哪些格式、各有几个启用的步骤”，扫描后在同一张表里补上文件数和体积。
import { computed } from 'vue';
import { useWorkbench } from '../core/workbench';
import { bytes } from '../core/model';
import { groupByResourceKind } from '../core/resource-groups';
import Icon from './Icon.vue';
import JobDock from './JobDock.vue';

const bench = useWorkbench();
const { config, definition, scan, scanStale, busy, job } = bench;

// 目录里的每种格式一行；扫描结果中目录已不再包含的格式也保留一行，归入“其他”，不让它的文件数消失。
const rows = computed(() => {
    const types = definition.value?.resourceTypes || [];
    const known = types.map(type => {
        const found = scan.value?.resources.find(item => item.id === type.id);
        return { id: type.id, name: type.displayName, extensions: type.extensions.join(' '), kind: type.kind as string, steps: config.value?.pipeline.filter(step => step.enabled && step.resourceType === type.id).length || 0, count: found?.count || 0, bytes: found?.bytes || 0 };
    });
    const unknown = (scan.value?.resources || []).filter(item => !types.some(type => type.id === item.id))
        .map(item => ({ id: item.id, name: item.name, extensions: '', kind: 'other', steps: 0, count: item.count, bytes: item.bytes }));
    return [...known, ...unknown];
});
const groups = computed(() => groupByResourceKind(rows.value, row => row.kind).map(group => ({
    ...group, count: group.items.reduce((sum, row) => sum + row.count, 0), bytes: group.items.reduce((sum, row) => sum + row.bytes, 0),
})));
const scanning = computed(() => job.value?.kind === 'preview' && !job.value.state.done);
</script>

<template>
  <aside class="inspector" aria-label="概览">
    <JobDock v-if="job" variant="panel" />

    <section class="block">
      <header class="head">
        <h2>{{ scan ? '扫描结果' : '概览' }}</h2>
        <button v-if="scan" type="button" class="button quiet small" :disabled="busy" @click="bench.runPipeline('preview')"><Icon name="refresh" :size="14" />重新扫描</button>
      </header>

      <template v-if="scan">
        <p v-if="scan.cancelled" class="callout warn"><Icon name="alert" class="tone warn" /><span>扫描已取消，结果不完整。检查了 {{ scan.checked }} / {{ scan.total }} 个文件。</span></p>
        <p v-else-if="scanStale" class="callout warn"><Icon name="alert" class="tone warn" /><span>配置已更改，下面的数字可能不再准确。</span></p>
        <dl class="figures rise">
          <div><dt>文件</dt><dd>{{ scan.total }}</dd></div>
          <div><dt>原始体积</dt><dd>{{ bytes(scan.totalBytes) }}</dd></div>
          <div><dt>会经过步骤</dt><dd>{{ scan.enabledFiles }}</dd></div>
          <div :class="{ alert: scan.conflicts }"><dt>输出冲突</dt><dd>{{ scan.conflicts }}</dd></div>
        </dl>
        <p v-if="scan.filteredOut" class="muted small">发现 {{ scan.discovered }} 个支持的文件，来源条件排除 {{ scan.filteredOut }} 个；这里只统计入选文件。</p>
        <section v-if="scan.issues.length" class="issues">
          <h3>需要注意</h3>
          <ul class="selectable"><li v-for="issue in scan.issues" :key="issue">{{ issue }}</li></ul>
        </section>
      </template>
      <p v-else class="empty">
        <Icon name="scan" :size="18" />
        <span>{{ scanning ? '正在统计文件…' : '点“扫描预览”统计文件数和体积，不会改动任何内容。' }}</span>
      </p>
    </section>

    <section class="block formats">
      <h3>资源格式</h3>
      <div class="frame">
        <table class="table">
          <colgroup><col><col class="narrow"><col v-if="scan" class="narrow"><col v-if="scan" class="wide"></colgroup>
          <thead><tr><th>格式</th><th class="number">步骤</th><th v-if="scan" class="number">文件</th><th v-if="scan" class="number">体积</th></tr></thead>
          <tbody v-for="group in groups" :key="group.id" :aria-label="group.label">
            <tr class="resource-group"><th colspan="2" scope="rowgroup">{{ group.label }}</th><th v-if="scan" class="number">{{ group.count }}</th><th v-if="scan" class="number">{{ bytes(group.bytes) }}</th></tr>
            <tr v-for="row in group.items" :key="row.id" :class="{ idle: !row.steps }">
              <td :title="row.extensions ? `${row.name}（${row.extensions}）` : row.name"><span class="cell"><span class="name">{{ row.name }}</span><span v-if="!scan" class="ext path">{{ row.extensions }}</span></span></td>
              <td class="number">{{ row.steps || '—' }}</td>
              <td v-if="scan" class="number">{{ row.count }}</td>
              <td v-if="scan" class="number">{{ row.count ? bytes(row.bytes) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="muted small">没有启用步骤的格式在另存时原样复制；其他扩展名的文件不会被处理，也不会复制。</p>
    </section>
  </aside>
</template>

<style scoped>
.inspector { display: flex; flex-direction: column; gap: var(--s-5); min-height: 0; overflow-y: auto; padding: var(--pane-padding) var(--s-4) var(--s-6); background: var(--pane); border-left: 1px solid var(--border-soft); }
.block { display: grid; gap: var(--s-3); }
.head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); min-height: var(--control-small); }
h2 { font-size: var(--t-title); letter-spacing: 0; }
h3 { color: var(--text-2); font-size: var(--t-small); font-weight: 600; }

.figures { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; margin: 0; border-radius: var(--r-panel); background: var(--border-soft); box-shadow: var(--shadow-card); overflow: hidden; }
.figures > div { padding: var(--s-3); background: var(--control); min-width: 0; }
.figures dt { color: var(--text-2); font-size: var(--t-small); }
.figures dd { margin: 0; font-size: var(--t-figure); font-weight: 600; line-height: 1.3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.figures .alert dd { color: var(--danger); }
.empty { display: flex; gap: var(--s-2); align-items: flex-start; padding: var(--s-3); border: 1px dashed var(--border); border-radius: var(--r-panel); color: var(--text-2); }
.empty .icon { margin-top: 1px; color: var(--text-3); }
.issues { display: grid; gap: var(--s-1); }
.issues ul { margin: 0; padding-left: 1.2em; color: var(--warn); }

.formats .table { table-layout: fixed; }
.narrow { width: 44px; }
.wide { width: 76px; }
.cell { display: flex; align-items: baseline; gap: var(--s-2); min-width: 0; }
.name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ext { flex: 0 10 auto; color: var(--text-3); cursor: default; user-select: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.idle td { color: var(--text-2); }
.formats .table th, .formats .table td { padding-left: var(--s-2); padding-right: var(--s-2); }
.formats .table th:first-child, .formats .table td:first-child { padding-left: var(--s-3); }
.formats .table th:last-child, .formats .table td:last-child { padding-right: var(--s-3); }
/* 窄窗口：概览栏在处理页下方成为一条，只留作业与四个扫描数字 */
@media (max-width: 1040px) {
  .inspector { gap: var(--s-2); padding: var(--s-2) var(--s-4); border-left: 0; border-top: 1px solid var(--border-soft); }
  .formats, .empty, .issues { display: none; }
  .figures { grid-template-columns: repeat(4, 1fr); }
  .figures > div { padding: var(--s-2) var(--s-3); }
  .figures dd { font-size: var(--t-title); }
}
</style>
