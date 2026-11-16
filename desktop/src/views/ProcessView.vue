<script setup lang="ts">
// 处理页：顶部命令栏（摘要与运行命令），左侧处理线选择站点，中间编辑该站点，右侧概览栏显示进度与结果。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useWorkbench } from '../core/workbench';
import { onFolderDrop } from '../core/api';
import PipelineRail from '../components/PipelineRail.vue';
import StepEditor from '../components/StepEditor.vue';
import PathField from '../components/PathField.vue';
import RunInspector from '../components/RunInspector.vue';
import Icon from '../components/Icon.vue';
import Tip from '../components/Tip.vue';
import FilterEditor from '../components/FilterEditor.vue';

const bench = useWorkbench();
const { config, definition, boot, station, scan, busy, blockedSteps, job } = bench;

const current = computed(() => {
    const key = station.value;
    if (!key.startsWith('step:') || !config.value) return undefined;
    const index = config.value.pipeline.findIndex(step => `step:${step.id}` === key);
    return index < 0 ? undefined : { index, step: config.value.pipeline[index]! };
});
const enabledCount = computed(() => config.value?.pipeline.filter(step => step.enabled).length || 0);
const observationOnly = computed(() => enabledCount.value > 0 && config.value!.pipeline.filter(step => step.enabled)
    .every(step => definition.value?.operations.find(op => op.id === step.operation)?.resultPolicy === 'observe'));
// 切换站点时编辑区回到顶部，避免新站点沿用上一个站点的滚动位置。
const detail = ref<HTMLElement>();
watch(station, () => { if (detail.value) detail.value.scrollTop = 0; });
const canStart = computed(() => !busy.value && !blockedSteps.value.length && Boolean(definition.value?.resourceTypes.length));

async function pickSource() {
    const folder = await bench.browse('选择来源文件夹', config.value?.sourceDir);
    if (folder && config.value) config.value.sourceDir = folder;
}

// 从资源管理器把文件夹拖进窗口：悬停时提示，松开后设为来源。只在原生窗口中生效。
const dropping = ref(false);
let stopDrop: (() => void) | undefined;
onMounted(async () => {
    try {
        stopDrop = await onFolderDrop(event => {
            dropping.value = event.type === 'over' && !busy.value;
            if (event.type === 'drop') void bench.useDroppedSource(event.paths);
        });
    } catch { /* 浏览器样式调试与组件测试中没有原生窗口。 */ }
});
onUnmounted(() => stopDrop?.());
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
          <Tip text="打开写入方式">
            <button type="button" class="summary-link" :class="{ 'tone warn': config.saveMode === 'overwrite' && !config.backupEnabled }" @click="station = 'output'">
              {{ observationOnly ? '仅分析，不写入素材' : config.saveMode === 'saveAs' ? '另存结果，保留原文件' : config.backupEnabled ? '覆盖原文件，替换前备份' : '覆盖原文件，不保留备份' }}
            </button>
          </Tip>
        </template>
      </div>
      <div class="run-actions">
        <Tip text="保存当前处理线，下次打开时恢复" shortcut="Ctrl+S"><button type="button" class="button quiet" :disabled="busy" @click="bench.saveConfig()"><Icon name="save" />保存配置</button></Tip>
        <Tip text="只统计文件，不改动任何内容"><button type="button" class="button" :disabled="busy" @click="bench.runPipeline('preview')"><Icon name="scan" />扫描预览</button></Tip>
        <button type="button" class="button primary" :disabled="!canStart" @click="bench.requestProcess()"><Icon name="play" />开始处理</button>
      </div>
    </header>

    <PipelineRail class="rail" />

    <section ref="detail" class="detail" :class="{ dropping }" aria-live="polite">
      <div class="sheet">
        <StepEditor
          v-if="current"
          :key="current.step.id"
          class="rise"
          :definition="definition"
          :model-value="current.step"
          :index="current.index"
          :count="config.pipeline.length"
          :disabled="busy"
          @update:model-value="bench.updateStep(current.index, $event)"
          @move="bench.moveStep(current.index, $event)"
          @remove="bench.requestRemoveStep(current.index)"
          @show-tools="bench.page.value = 'tools'"
        />

        <article v-else-if="station === 'output'" class="panel rise">
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
            <PathField v-if="config.backupEnabled" v-model="config.backupDir" label="备份文件夹" dialog-title="选择备份文件夹" :disabled="busy" hint="每次处理新建一个备份批次，可在“恢复”页还原。" />
            <p v-else class="callout warn"><Icon name="alert" class="tone warn" /><span>不备份时，被替换的原文件无法从本工具恢复。</span></p>
          </section>
          <section v-else class="group">
            <h3>另存位置</h3>
            <PathField v-model="config.outputDir" label="另存文件夹" dialog-title="选择另存文件夹" :disabled="busy" />
          </section>
        </article>

        <article v-else class="panel rise">
          <header class="panel-head"><h2>来源</h2><p class="muted">处理这个文件夹及其所有子文件夹中的资源，目录结构保持不变。</p></header>
          <button v-if="!config.sourceDir.trim()" type="button" class="dropzone" :disabled="busy" @click="pickSource">
            <Icon name="folder" :size="28" />
            <strong>选择要处理的文件夹</strong>
            <span class="muted">把文件夹拖进窗口，或点击这里选择</span>
          </button>
          <section class="group">
            <PathField v-model="config.sourceDir" label="来源文件夹" dialog-title="选择来源文件夹" :disabled="busy" />
          </section>
          <FilterEditor v-model="config.sourceFilter" :properties="definition.properties" :resource-types="definition.resourceTypes" :disabled="busy" title="来源过滤" hint="仅匹配的文件进入任务。排除的文件不复制、不处理、不备份；续跑使用已经固定的清单。分辨率可分别设置宽度、高度或总像素数。" />
        </article>
      </div>
      <p v-if="dropping" class="drop-hint" role="status"><Icon name="folder" :size="20" />松开后设为来源文件夹</p>
    </section>

    <RunInspector class="inspector" :class="{ bare: !scan && !job }" />
  </div>
</template>

<style scoped>
.process {
  display: grid;
  grid-template-columns: var(--rail-width) minmax(0, 1fr) var(--inspector-width);
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
.summary-link { height: 22px; padding: 0 var(--s-2); border: 0; border-radius: 11px; background: var(--pressed); color: var(--text); font-size: var(--t-small); white-space: nowrap; }
.summary-link:hover { background: var(--border); }
.summary-link.warn { background: var(--warn-wash); color: var(--warn); }
.run-actions { display: flex; gap: var(--s-2); flex: none; }

.rail { min-height: 0; }
.detail { position: relative; min-height: 0; overflow-y: auto; }
.inspector { min-height: 0; }
.sheet { container: editor / inline-size; max-width: var(--measure); padding: var(--pane-padding) var(--pane-padding) var(--s-7); }
.panel { display: grid; gap: var(--s-4); }
.panel-head { display: grid; gap: 2px; }

/* 还没有来源时的落地区：整块可点，也提示可以拖入 */
.dropzone { display: grid; justify-items: center; gap: var(--s-1); padding: var(--s-7) var(--s-4); border: 1.5px dashed var(--border); border-radius: var(--r-panel); background: none; color: var(--text); transition: border-color 0.12s ease, background-color 0.12s ease; }
.dropzone .icon { margin-bottom: var(--s-1); color: var(--accent); }
.dropzone strong { font-size: var(--t-title); font-weight: 600; }
.dropzone:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-wash); }
.dropzone:disabled { color: var(--text-3); }
/* 拖入悬停：整个编辑区罩上强调色虚线框 */
.dropping > .sheet { opacity: 0.35; }
.drop-hint { position: absolute; inset: var(--s-3); display: flex; align-items: center; justify-content: center; gap: var(--s-2); border: 2px dashed var(--accent); border-radius: var(--r-float); background: var(--accent-wash); color: var(--accent); font-size: var(--t-title); font-weight: 600; pointer-events: none; }

/* 写入方式：两个互斥的选项行，选中项用强调色描边 */
.modes { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-2); margin: 0; padding: 0; border: 0; min-width: 0; }
.mode { display: flex; gap: var(--s-3); align-items: flex-start; padding: var(--s-3) var(--s-4); border-radius: var(--r-panel); background: var(--control); box-shadow: var(--shadow-card); transition: box-shadow 0.12s ease; }
.mode:hover { box-shadow: 0 0 0 1px var(--text-3); }
.mode input { margin-top: 2px; }
.mode > span { display: grid; gap: 2px; }
.mode.chosen { box-shadow: 0 0 0 2px var(--accent); }
.modes:disabled .mode { color: var(--text-3); }

.unavailable { display: grid; align-content: start; gap: var(--s-2); padding: var(--s-6); max-width: var(--measure); }
@container editor (max-width: 520px) {
  .modes { grid-template-columns: 1fr; }
}
/* 窄窗口：概览栏移到下方成为一条，只保留作业与扫描数字 */
@media (max-width: 1040px) {
  .process { grid-template-columns: var(--rail-width) minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; }
  .inspector { grid-column: 1 / -1; max-height: 38vh; }
  .inspector.bare { display: none; }
}
</style>
