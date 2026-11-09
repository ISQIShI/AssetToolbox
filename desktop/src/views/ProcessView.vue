<script setup lang="ts">
// 处理页：左侧处理线选择站点，右侧编辑该站点；底部是运行栏（有作业时由作业栏接替）。
import { computed, ref, watch } from 'vue';
import { useWorkbench } from '../core/workbench';
import PipelineRail from '../components/PipelineRail.vue';
import StepEditor from '../components/StepEditor.vue';
import PathField from '../components/PathField.vue';
import ScanSummary from '../components/ScanSummary.vue';

const bench = useWorkbench();
const { config, definition, boot, station, scan, scanStale, busy, job, blockedSteps } = bench;

const current = computed(() => {
    const key = station.value;
    if (!key.startsWith('step:') || !config.value) return undefined;
    const index = config.value.pipeline.findIndex(step => `step:${step.id}` === key);
    return index < 0 ? undefined : { index, step: config.value.pipeline[index]! };
});
const enabledCount = computed(() => config.value?.pipeline.filter(step => step.enabled).length || 0);
const coverage = computed(() => definition.value?.resourceTypes.map(type => ({
    type, steps: config.value?.pipeline.filter(step => step.enabled && step.resourceType === type.id).length || 0,
})) || []);
// 切换站点时编辑区回到顶部，避免新站点沿用上一个站点的滚动位置。
const detail = ref<HTMLElement>();
watch(station, () => { if (detail.value) detail.value.scrollTop = 0; });
const canStart = computed(() => !busy.value && !blockedSteps.value.length && Boolean(definition.value?.resourceTypes.length));
</script>

<template>
  <div v-if="!config || !definition" class="unavailable">
    <h2>处理功能暂不可用</h2>
    <p v-if="boot?.configError">读取处理配置或扩展时出错：{{ boot.configError }}</p>
    <p>任务和恢复不依赖处理工具，仍可正常使用。</p>
  </div>

  <div v-else class="process">
    <PipelineRail class="rail" />

    <section ref="detail" class="detail" aria-live="polite">
      <div class="sheet">
        <StepEditor
          v-if="current"
          :key="current.step.id"
          :definition="definition"
          :model-value="current.step"
          :index="current.index"
          :count="config.pipeline.length"
          :disabled="busy"
          @update:model-value="config.pipeline[current.index] = $event"
          @move="bench.moveStep(current.index, $event)"
          @remove="bench.removeStep(current.index)"
          @show-tools="bench.page.value = 'tools'"
        />

        <article v-else-if="station === 'output'" class="panel">
          <h2>写入方式</h2>
          <fieldset class="modes" :disabled="busy">
            <legend class="visually-hidden">写入方式</legend>
            <label class="mode" :class="{ chosen: config.saveMode === 'overwrite' }">
              <input v-model="config.saveMode" type="radio" value="overwrite">
              <span><strong>覆盖原文件</strong><span class="muted">一个文件的全部步骤都成功后，才替换这个文件。</span></span>
            </label>
            <label class="mode" :class="{ chosen: config.saveMode === 'saveAs' }">
              <input v-model="config.saveMode" type="radio" value="saveAs">
              <span><strong>另存到新文件夹</strong><span class="muted">原文件保持不变，结果按原目录结构写入新位置。</span></span>
            </label>
          </fieldset>
          <template v-if="config.saveMode === 'overwrite'">
            <label class="check"><input v-model="config.backupEnabled" type="checkbox" :disabled="busy">替换前备份原文件</label>
            <PathField v-if="config.backupEnabled" v-model="config.backupDir" label="备份文件夹" dialog-title="选择备份文件夹" :disabled="busy" hint="每次处理在这里新建一个备份批次，之后可在“恢复”页还原。" />
            <p v-else class="callout warn">不备份时，被替换的原文件无法从本工具恢复。</p>
          </template>
          <PathField v-else v-model="config.outputDir" label="另存文件夹" dialog-title="选择另存文件夹" :disabled="busy" hint="没有启用步骤的已识别资源会原样复制到这里。" />
        </article>

        <ScanSummary v-else-if="station === 'scan' && scan" :scan="scan" :stale="scanStale" :disabled="busy" @rescan="bench.runPipeline('preview')" />

        <article v-else class="panel">
          <h2>来源</h2>
          <p class="muted">处理这个文件夹及其所有子文件夹中的资源，目录结构保持不变。</p>
          <PathField v-model="config.sourceDir" label="来源文件夹" dialog-title="选择来源文件夹" :disabled="busy" />
          <section class="coverage">
            <h3>会识别的资源</h3>
            <table class="table">
              <thead><tr><th>资源类型</th><th>扩展名</th><th class="number">启用的步骤</th></tr></thead>
              <tbody>
                <tr v-for="row in coverage" :key="row.type.id">
                  <td>{{ row.type.displayName }}</td>
                  <td class="path">{{ row.type.extensions.join(' ') }}</td>
                  <td class="number" :class="{ muted: !row.steps }">{{ row.steps || '无' }}</td>
                </tr>
              </tbody>
            </table>
            <p class="muted small">其他扩展名的文件不会被处理，也不会复制。</p>
          </section>
        </article>
      </div>
    </section>

    <footer v-if="!job" class="runbar">
      <div class="summary">
        <template v-if="blockedSteps.length">
          <span class="tone missing">第 {{ blockedSteps.map(item => item.index + 1).join('、') }} 步的处理工具缺少依赖，安装或停用后才能开始处理。</span>
          <button type="button" class="summary-link" @click="bench.page.value = 'tools'">查看获取方式</button>
        </template>
        <template v-else>
          <span>{{ config.pipeline.length ? `${enabledCount} / ${config.pipeline.length} 个步骤已启用` : '还没有步骤，添加后才会改动文件' }}</span>
          <button type="button" class="summary-link" :class="{ 'tone warn': config.saveMode === 'overwrite' && !config.backupEnabled }" @click="station = 'output'">
            {{ config.saveMode === 'saveAs' ? '另存结果，保留原文件' : config.backupEnabled ? '覆盖原文件，替换前备份' : '覆盖原文件，不保留备份' }}
          </button>
        </template>
      </div>
      <div class="run-actions">
        <button type="button" class="button" :disabled="busy" @click="bench.saveConfig()">保存配置</button>
        <button type="button" class="button" :disabled="busy" @click="bench.runPipeline('preview')">扫描预览</button>
        <button type="button" class="button primary" :disabled="!canStart" @click="bench.runPipeline('process')">开始处理</button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.process {
  display: grid;
  grid-template-columns: var(--rail-width) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 0;
}
.rail { grid-row: 1; min-height: 0; }
.detail { grid-row: 1; min-height: 0; overflow-y: auto; background: var(--paper); }
.sheet { container: editor / inline-size; max-width: var(--measure); padding: var(--pane-padding) var(--pane-padding) var(--s-7); }
.panel { display: grid; gap: var(--s-5); }
.coverage { display: grid; gap: var(--s-2); }
h2 { font-size: var(--t-heading); }
h3 { font-size: var(--t-body); margin-bottom: var(--s-2); }

.modes { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3); margin: 0; padding: 0; border: 0; }
.mode { display: flex; gap: var(--s-3); align-items: flex-start; padding: var(--s-4); border: 1px solid var(--rule); border-radius: var(--r-control); cursor: pointer; }
.mode input { margin-top: 4px; }
.mode > span { display: grid; gap: var(--s-1); }
.mode.chosen { border-color: var(--ink); box-shadow: inset 0 0 0 1px var(--ink); }
.modes:disabled .mode { cursor: not-allowed; color: var(--ink-3); }
.check { font-weight: 500; }

.runbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  padding: var(--s-3) var(--s-5);
  border-top: 1px solid var(--rule);
  background: var(--canvas);
}
.summary { display: grid; justify-items: start; gap: var(--s-1); color: var(--ink-2); min-width: 0; font-size: var(--t-small); }
.summary-link { border: 0; padding: 0; background: none; color: var(--ink); font-size: var(--t-small); text-align: left; cursor: pointer; text-decoration: underline; text-decoration-color: var(--rule); text-underline-offset: 3px; }
.summary-link:hover { text-decoration-color: currentColor; }
.summary-link.warn { color: var(--warn); }
.run-actions { display: flex; gap: var(--s-2); flex: none; }

.unavailable { display: grid; align-content: start; gap: var(--s-3); padding: var(--s-7) var(--s-6); max-width: var(--measure); }
@container editor (max-width: 600px) {
  .modes { grid-template-columns: 1fr; }
}

@media (max-width: 760px) {
  .process { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr) auto; }
  .rail { grid-row: 1; max-height: 28vh; box-shadow: inset 0 -1px 0 var(--rule); }
  .detail { grid-row: 2; }
  .modes { grid-template-columns: 1fr; }
  .runbar { flex-wrap: wrap; padding: var(--s-3) var(--s-4); }
  .run-actions { width: 100%; }
  .run-actions > .button { flex: 1; padding: 0 var(--s-2); }
}
</style>
