<script setup lang="ts">
import type { ScanPreview } from '../core/types';
import { bytes } from '../core/model';
defineProps<{ scan: ScanPreview; stale?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ rescan: [] }>();
</script>

<template>
  <article class="scan">
    <header class="head">
      <h2>扫描结果</h2>
      <button type="button" class="button" :disabled="disabled" @click="emit('rescan')">重新扫描</button>
    </header>
    <p v-if="scan.cancelled" class="callout warn">扫描已取消，结果不完整。检查了 {{ scan.checked }} / {{ scan.total }} 个文件。</p>
    <p v-else-if="stale" class="callout warn">扫描后配置已更改，下面的结果可能不再准确。</p>

    <dl class="figures">
      <div><dt>识别的资源文件</dt><dd>{{ scan.total }}</dd></div>
      <div><dt>原始体积</dt><dd>{{ bytes(scan.totalBytes) }}</dd></div>
      <div><dt>将经过启用步骤</dt><dd>{{ scan.enabledFiles }}</dd></div>
      <div :class="{ alert: scan.conflicts }"><dt>输出冲突</dt><dd>{{ scan.conflicts }}</dd></div>
    </dl>

    <table v-if="scan.resources.length" class="table">
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

    <section v-if="scan.issues.length" class="issues">
      <h3>需要注意</h3>
      <ul><li v-for="issue in scan.issues" :key="issue">{{ issue }}</li></ul>
    </section>
  </article>
</template>

<style scoped>
.scan { display: grid; gap: var(--s-5); }
.head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); }
h2 { font-size: var(--t-heading); }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(104px, 1fr)); margin: 0; border-top: 2px solid var(--ink); }
.figures > div { padding: var(--s-3) var(--s-4) var(--s-3) 0; }
.figures dt { color: var(--ink-2); font-size: var(--t-small); }
.figures dd { margin: 0; font-size: var(--t-heading); font-weight: 500; }
.figures .alert dd { color: var(--danger); }
h3 { font-size: var(--t-body); margin-bottom: var(--s-2); }
.issues ul { margin: 0; padding-left: 1.2em; color: var(--warn); }
</style>
