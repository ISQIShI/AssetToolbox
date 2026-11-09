<script setup lang="ts">
// 处理线：来源 → 各步骤 → 写入 →（扫描结果）。这是界面上唯一的强调元素，
// 文件沿竖线自上而下经过每个站点，编号即执行顺序。
import { computed, ref } from 'vue';
import { useWorkbench } from '../core/workbench';
import { folderName, isMissing, providerOf, stepChoices, stepTitle } from '../core/model';

const bench = useWorkbench();
const { config, definition, station, scan, scanStale, busy } = bench;
const adding = ref(false);

const choices = computed(() => definition.value ? stepChoices(definition.value) : []);
const full = computed(() => (config.value?.pipeline.length || 0) >= 64);
const steps = computed(() => config.value && definition.value ? config.value.pipeline.map((step, index) => {
    const provider = providerOf(definition.value!, step);
    return { key: `step:${step.id}`, number: index + 1, step, title: stepTitle(definition.value!, step), tool: provider?.displayName || step.provider, missing: isMissing(provider) };
}) : []);
const sourceLabel = computed(() => config.value?.sourceDir.trim() ? folderName(config.value.sourceDir) : '未选择文件夹');
const outputTitle = computed(() => config.value?.saveMode === 'saveAs' ? '另存到新文件夹' : '覆盖原文件');
const outputLabel = computed(() => {
    const value = config.value;
    if (!value) return '';
    if (value.saveMode === 'saveAs') return value.outputDir.trim() ? folderName(value.outputDir) : '未选择文件夹';
    return value.backupEnabled ? `备份到 ${value.backupDir.trim() ? folderName(value.backupDir) : '（未选择）'}` : '不备份';
});

function choose(resourceType: string, operation: string) { bench.addStep(resourceType, operation); adding.value = false; }
</script>

<template>
  <nav class="rail" aria-label="处理顺序">
    <ol class="line">
      <li class="station endpoint">
        <button type="button" class="station-button" data-station="source" :aria-current="station === 'source' ? 'true' : undefined" @click="station = 'source'">
          <span class="node" aria-hidden="true"></span>
          <span class="text"><span class="title">来源</span><span class="sub path">{{ sourceLabel }}</span></span>
        </button>
      </li>

      <li v-for="item in steps" :key="item.key" class="station" :class="{ off: !item.step.enabled, missing: item.missing }" :data-step-id="item.step.id">
        <button type="button" class="station-button" :aria-current="station === item.key ? 'true' : undefined" @click="station = item.key">
          <span class="node numbered" aria-hidden="true">{{ item.number }}</span>
          <span class="text">
            <span class="title"><span class="visually-hidden">第 {{ item.number }} 步 </span>{{ item.title }}</span>
            <span class="sub">
              <span v-if="item.missing" class="tone missing"><span class="missing-swatch" aria-hidden="true"></span> 缺少依赖</span>
              <span v-else-if="!item.step.enabled">已停用</span>
              <span v-else>{{ item.tool }}</span>
            </span>
          </span>
        </button>
      </li>

      <li class="station adder">
        <button type="button" class="station-button" :aria-expanded="adding" :disabled="busy || full || !choices.length" @click="adding = !adding">
          <span class="node plus" aria-hidden="true">+</span>
          <span class="text"><span class="title">添加步骤</span><span v-if="full" class="sub">已达到 64 步上限</span></span>
        </button>
        <ul v-if="adding" class="choices" aria-label="可添加的步骤" @keydown.esc="adding = false">
          <li v-for="choice in choices" :key="`${choice.resourceType}/${choice.operation}`">
            <button type="button" class="choice" @click="choose(choice.resourceType, choice.operation)">{{ choice.label }}</button>
          </li>
        </ul>
      </li>

      <li class="station endpoint">
        <button type="button" class="station-button" data-station="output" :aria-current="station === 'output' ? 'true' : undefined" @click="station = 'output'">
          <span class="node" aria-hidden="true"></span>
          <span class="text"><span class="title">{{ outputTitle }}</span><span class="sub path">{{ outputLabel }}</span></span>
        </button>
      </li>

      <li v-if="scan" class="station result">
        <button type="button" class="station-button" data-station="scan" :aria-current="station === 'scan' ? 'true' : undefined" @click="station = 'scan'">
          <span class="node" aria-hidden="true"></span>
          <span class="text"><span class="title">扫描结果</span><span class="sub" :class="{ 'tone warn': scanStale || scan.cancelled }">{{ scan.cancelled ? '扫描未完成' : scanStale ? '配置已更改' : `${scan.total} 个文件` }}</span></span>
        </button>
      </li>
    </ol>
  </nav>
</template>

<style scoped>
.rail {
  overflow-y: auto;
  background: var(--canvas);
  box-shadow: inset -1px 0 0 var(--rule);
}
.line { list-style: none; margin: 0; padding: var(--s-4) 0 var(--s-6); }

/* 竖线：每个站点画自己那一段，首尾从节点中心开始/结束 */
.station { position: relative; }
.station::before {
  content: '';
  position: absolute;
  left: 31px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--ink);
}
.station:first-child::before { top: 25px; }
.station:last-child::before { bottom: auto; height: 25px; }
.station.off::before { background: repeating-linear-gradient(var(--ink-3) 0 4px, transparent 4px 8px); }

.station-button {
  position: relative;
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: start;
  width: 100%;
  padding: var(--s-3) var(--s-4) var(--s-3) var(--s-3);
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}
.station-button:hover:not(:disabled) .title { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: var(--ink-3); }
.station-button[aria-current='true'] { background: var(--paper); }
.station-button:disabled { cursor: not-allowed; color: var(--ink-3); }
.station-button:focus-visible { outline-offset: -2px; }

.node {
  position: relative;
  z-index: 1;
  justify-self: center;
  width: 12px;
  height: 12px;
  margin-top: 7px;
  background: var(--ink);
}
.node.numbered {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-top: 1px;
  border: 2px solid var(--ink);
  border-radius: 50%;
  background: var(--ink);
  color: var(--paper);
  font-size: var(--t-small);
  font-weight: 600;
}
.off .node.numbered { background: var(--canvas); border-color: var(--ink-3); color: var(--ink-3); }
.off [aria-current='true'] .node.numbered { background: var(--paper); }
.missing .node.numbered { border-color: var(--missing); background: var(--missing); }
.off.missing .node.numbered { background: var(--canvas); color: var(--missing); }
.node.plus {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-top: 1px;
  border: 2px dashed var(--ink-2);
  border-radius: 50%;
  background: var(--canvas);
  color: var(--ink-2);
  font-weight: 600;
  line-height: 1;
}
.result .node { background: var(--canvas); border: 2px solid var(--ink); }
.result [aria-current='true'] .node { background: var(--paper); }

.text { display: grid; min-width: 0; padding-top: 2px; }
.title { font-weight: 600; }
.off .title { color: var(--ink-2); font-weight: 500; }
.adder .title { color: var(--ink-2); font-weight: 500; }
.sub { color: var(--ink-2); font-size: var(--t-small); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub .tone { display: inline-flex; align-items: center; gap: var(--s-1); }

.choices { list-style: none; margin: 0 var(--s-4) var(--s-2) 52px; padding: var(--s-1) 0; border: 1px solid var(--rule); border-radius: var(--r-float); background: var(--paper); }
.choice { width: 100%; padding: var(--s-1) var(--s-3); border: 0; background: none; text-align: left; cursor: pointer; }
.choice:hover { background: var(--paper-sunk); }
</style>
