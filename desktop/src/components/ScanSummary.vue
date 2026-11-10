<script setup lang="ts">
import type { ScanPreview } from '../core/types';
import { bytes } from '../core/model';
import Icon from './Icon.vue';
defineProps<{ scan: ScanPreview; stale?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ rescan: [] }>();
</script>

<template>
  <article class="scan">
    <header class="head">
      <div class="heading"><h2>扫描结果</h2><p class="muted">扫描只统计文件，没有改动任何内容。</p></div>
      <button type="button" class="button" :disabled="disabled" @click="emit('rescan')"><Icon name="refresh" />重新扫描</button>
    </header>
    <p v-if="scan.cancelled" class="callout warn"><Icon name="alert" class="tone warn" /><span>扫描已取消，结果不完整。检查了 {{ scan.checked }} / {{ scan.total }} 个文件。</span></p>
    <p v-else-if="stale" class="callout warn"><Icon name="alert" class="tone warn" /><span>扫描后配置已更改，下面的结果可能不再准确。</span></p>

    <dl class="figures">
      <div><dt>识别的资源文件</dt><dd>{{ scan.total }}</dd></div>
      <div><dt>原始体积</dt><dd>{{ bytes(scan.totalBytes) }}</dd></div>
      <div><dt>将经过启用步骤</dt><dd>{{ scan.enabledFiles }}</dd></div>
      <div :class="{ alert: scan.conflicts }"><dt>输出冲突</dt><dd>{{ scan.conflicts }}</dd></div>
    </dl>

    <div v-if="scan.resources.length" class="grid-frame">
      <table class="table">
        <thead><tr><th>资源类型</th><th class="number">文件数</th><th class="number">体积</th><th>处理方式</th></tr></thead>
        <tbody>
          <tr v-for="resource in scan.resources" :key="resource.id">
            <td>{{ resource.name }}</td>
            <td class="number">{{ resource.count }}</td>
            <td class="number">{{ bytes(resource.bytes) }}</td>
            <td :class="resource.enabled ? '' : 'muted'">{{ resource.enabled ? '经过启用的步骤' : '没有启用的步骤' }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <section v-if="scan.issues.length" class="group issues">
      <h3>需要注意</h3>
      <ul class="selectable"><li v-for="issue in scan.issues" :key="issue">{{ issue }}</li></ul>
    </section>
  </article>
</template>

<style scoped>
.scan { display: grid; gap: var(--s-4); }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-4); }
.heading { display: grid; gap: 2px; }
/* 四个关键数字并排在一个面板里，用竖线分隔 */
.figures { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; border: 1px solid var(--border-soft); border-radius: var(--r-panel); background: var(--control); }
.figures > div { padding: var(--s-3) var(--s-4); border-left: 1px solid var(--border-soft); min-width: 0; }
.figures > div:first-child { border-left: 0; }
.figures dt { color: var(--text-2); font-size: var(--t-small); }
.figures dd { margin: 0; font-size: var(--t-figure); font-weight: 600; line-height: 1.3; white-space: nowrap; }
.figures .alert dd { color: var(--danger); }
.grid-frame { border: 1px solid var(--border-soft); border-radius: var(--r-panel); background: var(--control); overflow: hidden; }
.grid-frame .table tr:last-child td { border-bottom: 0; }
.issues ul { margin: 0; padding-left: 1.2em; color: var(--warn); }
@container editor (max-width: 520px) {
  .figures { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .figures > div:nth-child(3) { border-left: 0; }
  .figures > div:nth-child(n + 3) { border-top: 1px solid var(--border-soft); }
}
</style>
