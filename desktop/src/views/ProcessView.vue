<script setup lang="ts">
// 处理页：顶部命令栏（摘要与运行命令），左侧处理线选择站点，右侧编辑该站点。
import { computed, ref, watch } from 'vue';
import { useWorkbench } from '../core/workbench';
import PipelineRail from '../components/PipelineRail.vue';
import StepEditor from '../components/StepEditor.vue';
import PathField from '../components/PathField.vue';
import ScanSummary from '../components/ScanSummary.vue';
import Icon from '../components/Icon.vue';

const bench = useWorkbench();
const { config, definition, boot, station, scan, scanStale, busy, blockedSteps } = bench;

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
    <p v-if="boot?.configError" class="selectable">读取处理配置或扩展时出错：{{ boot.configError }}</p>
    <p class="muted">任务和恢复不依赖处理工具，仍可正常使用。</p>
  </div>

  <div v-else class="process">
    <header class="runbar">
      <div class="summary">
        <template v-if="blockedSteps.length">
          <span class="tone missing blocked"><span class="missing-swatch" aria-hidden="true"></span>第 {{ blockedSteps.map(item => item.index + 1).join('、') }} 步的处理工具缺少依赖，安装或停用后才能开始处理。</span>
          <button type="button" class="summary-link" @click="bench.page.value = 'tools'">查看获取方式</button>
        </template>
        <template v-else>
          <span class="muted">{{ config.pipeline.length ? `${enabledCount} / ${config.pipeline.length} 个步骤已启用` : '还没有步骤，添加后才会改动文件' }}</span>
          <button type="button" class="summary-link" :class="{ 'tone warn': config.saveMode === 'overwrite' && !config.backupEnabled }" title="打开写入方式" @click="station = 'output'">
            {{ config.saveMode === 'saveAs' ? '另存结果，保留原文件' : config.backupEnabled ? '覆盖原文件，替换前备份' : '覆盖原文件，不保留备份' }}
          </button>
        </template>
      </div>
      <div class="run-actions">
        <button type="button" class="button quiet" title="保存配置（Ctrl+S）" :disabled="busy" @click="bench.saveConfig()"><Icon name="save" />保存配置</button>
        <button type="button" class="button" title="只统计文件，不改动任何内容" :disabled="busy" @click="bench.runPipeline('preview')"><Icon name="scan" />扫描预览</button>
        <button type="button" class="button primary" :disabled="!canStart" @click="bench.runPipeline('process')"><Icon name="play" />开始处理</button>
      </div>
    </header>

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
          <header class="panel-head"><h2>写入方式</h2><p class="muted">处理结果写到哪里，以及原文件如何保留。</p></header>
          <fieldset class="modes" :disabled="busy">
            <legend class="visually-hidden">写入方式</legend>
            <label class="mode" :class="{ chosen: config.saveMode === 'overwrite' }">
              <input v-model="config.saveMode" type="radio" value="overwrite">
              <span><strong>覆盖原文件</strong><span class="muted small">一个文件的全部步骤都成功后，才替换这个文件。</span></span>
            </label>
            <label class="mode" :class="{ chosen: config.saveMode === 'saveAs' }">
              <input v-model="config.saveMode" type="radio" value="saveAs">
              <span><strong>另存到新文件夹</strong><span class="muted small">原文件保持不变，结果按原目录结构写入新位置。</span></span>
            </label>
          </fieldset>
          <section v-if="config.saveMode === 'overwrite'" class="group">
            <h3>备份</h3>
            <label class="check"><input v-model="config.backupEnabled" type="checkbox" :disabled="busy">替换前备份原文件</label>
            <PathField v-if="config.backupEnabled" v-model="config.backupDir" label="备份文件夹" dialog-title="选择备份文件夹" :disabled="busy" hint="每次处理在这里新建一个备份批次，之后可在“恢复”页还原。" />
            <p v-else class="callout warn"><Icon name="alert" class="tone warn" /><span>不备份时，被替换的原文件无法从本工具恢复。</span></p>
          </section>
          <section v-else class="group">
            <h3>另存位置</h3>
            <PathField v-model="config.outputDir" label="另存文件夹" dialog-title="选择另存文件夹" :disabled="busy" hint="没有启用步骤的已识别资源会原样复制到这里。" />
          </section>
        </article>

        <ScanSummary v-else-if="station === 'scan' && scan" :scan="scan" :stale="scanStale" :disabled="busy" @rescan="bench.runPipeline('preview')" />

        <article v-else class="panel">
          <header class="panel-head"><h2>来源</h2><p class="muted">处理这个文件夹及其所有子文件夹中的资源，目录结构保持不变。</p></header>
          <section class="group">
            <PathField v-model="config.sourceDir" label="来源文件夹" dialog-title="选择来源文件夹" :disabled="busy" />
          </section>
          <section class="coverage">
            <h3>会识别的资源</h3>
            <div class="grid-frame">
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
            </div>
            <p class="muted small">其他扩展名的文件不会被处理，也不会复制。</p>
          </section>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.process {
  display: grid;
  grid-template-columns: var(--rail-width) minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
}

/* 命令栏：左侧是当前处理线的摘要，右侧是运行命令 */
.runbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-4);
  min-height: var(--command-height);
  padding: 0 var(--s-3) 0 var(--s-4);
  border-bottom: 1px solid var(--border-soft);
  background: var(--pane);
}
.summary { display: flex; align-items: center; gap: var(--s-1) var(--s-3); flex-wrap: wrap; min-width: 0; padding: var(--s-1) 0; }
.blocked { display: inline-flex; align-items: center; gap: 6px; }
.summary-link { height: 22px; padding: 0 var(--s-2); border: 1px solid var(--border-soft); border-radius: 11px; background: var(--control); color: var(--text); font-size: var(--t-small); white-space: nowrap; }
.summary-link:hover { border-color: var(--text-3); }
.summary-link.warn { border-color: transparent; background: var(--warn-wash); color: var(--warn); }
.run-actions { display: flex; gap: var(--s-2); flex: none; }

.rail { min-height: 0; }
.detail { min-height: 0; overflow-y: auto; }
.sheet { container: editor / inline-size; max-width: var(--measure); padding: var(--pane-padding) var(--pane-padding) var(--s-7); }
.panel { display: grid; gap: var(--s-4); }
.panel-head { display: grid; gap: 2px; }
.coverage { display: grid; gap: var(--s-2); }
.grid-frame { border: 1px solid var(--border-soft); border-radius: var(--r-panel); background: var(--control); overflow: hidden; }
.grid-frame .table tr:last-child td { border-bottom: 0; }

/* 写入方式：两个互斥的选项行，选中项用强调色描边 */
.modes { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-2); margin: 0; padding: 0; border: 0; min-width: 0; }
.mode { display: flex; gap: var(--s-3); align-items: flex-start; padding: var(--s-3); border: 1px solid var(--border-soft); border-radius: var(--r-panel); background: var(--control); }
.mode:hover { border-color: var(--text-3); }
.mode input { margin-top: 2px; }
.mode > span { display: grid; gap: 2px; }
.mode.chosen { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.modes:disabled .mode { color: var(--text-3); }

.unavailable { display: grid; align-content: start; gap: var(--s-2); padding: var(--s-6); max-width: var(--measure); }
@container editor (max-width: 520px) {
  .modes { grid-template-columns: 1fr; }
}
</style>
