<script setup lang="ts">
// 处理线：来源 → 各步骤 → 写入 →（扫描结果）。文件沿竖线自上而下经过每个站点，编号即执行顺序。
import { computed, onUnmounted, ref, useId } from 'vue';
import { useWorkbench } from '../core/workbench';
import { folderName, isMissing, providerOf, stepChoices, stepTitle } from '../core/model';
import Icon from './Icon.vue';

const bench = useWorkbench();
const { config, definition, station, scan, scanStale, busy } = bench;
const adding = ref(false);
const addButton = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const menuStyle = ref<Record<string, string>>({});
const menuId = useId();

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

// 添加菜单是浮在处理线之上的弹出菜单：按触发按钮的位置定位，点击别处、Esc 或窗口变化时关闭。
function outside(event: Event) {
    const target = event.target as Node;
    if (!menu.value?.contains(target) && !addButton.value?.contains(target)) close(false);
}
function open() {
    const rect = addButton.value!.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    menuStyle.value = below >= 200 || below >= rect.top
        ? { left: `${rect.left + 8}px`, top: `${rect.bottom + 2}px`, maxHeight: `${Math.max(120, below - 12)}px` }
        : { left: `${rect.left + 8}px`, bottom: `${window.innerHeight - rect.top + 2}px`, maxHeight: `${Math.max(120, rect.top - 12)}px` };
    adding.value = true;
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
}
function close(refocus: boolean) {
    adding.value = false;
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', dismiss);
    if (refocus) addButton.value?.focus();
}
function dismiss() { close(false); }
function choose(resourceType: string, operation: string) { bench.addStep(resourceType, operation); close(false); }
function menuKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const items = Array.from(menu.value!.querySelectorAll<HTMLButtonElement>('.choice'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
}
onUnmounted(() => close(false));
</script>

<template>
  <nav class="rail" aria-label="处理顺序">
    <div class="rail-heading"><strong>处理线</strong><span>{{ steps.length }} 个步骤</span></div>
    <ol class="line">
      <li class="station endpoint">
        <button type="button" class="station-button" data-station="source" :aria-current="station === 'source' ? 'true' : undefined" @click="station = 'source'">
          <span class="node" aria-hidden="true"></span>
          <span class="text"><span class="title">来源</span><span class="sub">{{ sourceLabel }}</span></span>
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
        <button ref="addButton" type="button" class="station-button" aria-haspopup="menu" :aria-controls="menuId" :aria-expanded="adding" :disabled="busy || full || !choices.length" @click="adding ? close(false) : open()">
          <span class="node plus" aria-hidden="true"><Icon name="plus" :size="12" /></span>
          <span class="text"><span class="title">添加步骤</span><span v-if="full" class="sub">已达到 64 步上限</span></span>
        </button>
        <ul v-if="adding" :id="menuId" ref="menu" class="choices" :style="menuStyle" aria-label="可添加的步骤" @keydown.esc.stop="close(true)" @keydown="menuKey">
          <li v-for="choice in choices" :key="`${choice.resourceType}/${choice.operation}`">
            <button type="button" class="choice" @click="choose(choice.resourceType, choice.operation)">{{ choice.label }}</button>
          </li>
        </ul>
      </li>

      <li class="station endpoint">
        <button type="button" class="station-button" data-station="output" :aria-current="station === 'output' ? 'true' : undefined" @click="station = 'output'">
          <span class="node" aria-hidden="true"></span>
          <span class="text"><span class="title">{{ outputTitle }}</span><span class="sub">{{ outputLabel }}</span></span>
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
.rail { overflow-y: auto; background: var(--pane); border-right: 1px solid var(--border-soft); }
.rail-heading { position: sticky; top: 0; z-index: 3; display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-2); padding: var(--s-3) var(--s-4) var(--s-2); background: var(--pane); }
.rail-heading strong { font-weight: 600; }
.rail-heading span { color: var(--text-2); font-size: var(--t-small); }
.line { list-style: none; margin: 0; padding: 0 0 var(--s-5); }

/* 竖线：每个站点画自己那一段，首尾从节点中心开始/结束 */
.station { position: relative; }
.station::before {
  content: '';
  position: absolute;
  z-index: 1;
  pointer-events: none;
  left: 25px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--border);
}
.station:first-child::before { top: 20px; }
.station:last-child::before { bottom: auto; height: 20px; }
.station.off::before { background: repeating-linear-gradient(var(--border) 0 4px, transparent 4px 8px); }

.station-button {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: var(--s-1);
  align-items: start;
  width: calc(100% - var(--s-4));
  margin: 1px var(--s-2);
  padding: 5px var(--s-2) 5px var(--s-1);
  border: 0;
  border-radius: var(--r-control);
  background: none;
  text-align: left;
}
.station-button:hover:not(:disabled) { background: var(--hover); }
.station-button { --ring: var(--pane); }
.station-button[aria-current='true'] { --ring: var(--accent-wash); background: var(--accent-wash); }
.station-button:disabled { color: var(--text-3); }
.station-button:focus-visible { outline-offset: -2px; }

/* 节点带一圈与底色相同的描边，把竖线在节点处“断开” */
.node {
  position: relative;
  z-index: 2;
  justify-self: center;
  width: 10px;
  height: 10px;
  margin-top: 5px;
  border-radius: 2px;
  background: var(--text);
  box-shadow: 0 0 0 3px var(--ring);
}
.node.numbered {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-top: 0;
  border-radius: 50%;
  color: var(--ring);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  box-shadow: 0 0 0 2px var(--ring);
}
.off .node.numbered { background: var(--ring); color: var(--text-3); box-shadow: inset 0 0 0 1.5px var(--text-3), 0 0 0 2px var(--ring); }
.missing .node.numbered { background: var(--missing); color: var(--on-missing); }
.off.missing .node.numbered { background: var(--ring); color: var(--missing); box-shadow: inset 0 0 0 1.5px var(--missing), 0 0 0 2px var(--ring); }
.node.plus { display: grid; place-items: center; width: 20px; height: 20px; margin-top: 0; border-radius: 50%; background: var(--ring); color: var(--text-2); box-shadow: inset 0 0 0 1.5px var(--text-3), 0 0 0 2px var(--ring); }
.result .node { background: var(--ring); box-shadow: inset 0 0 0 2px var(--text), 0 0 0 3px var(--ring); }

.text { display: grid; min-width: 0; padding-top: 1px; }
.title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.off .title { color: var(--text-2); }
.adder .title { color: var(--text-2); line-height: 20px; }
.sub { color: var(--text-2); font-size: var(--t-small); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub .tone { display: inline-flex; align-items: center; gap: var(--s-1); }

/* 弹出菜单 */
.choices { position: fixed; z-index: 20; list-style: none; min-width: 200px; margin: 0; padding: var(--s-1); overflow-y: auto; border: 1px solid var(--border-soft); border-radius: var(--r-float); background: var(--control); box-shadow: var(--shadow-float); }
.choice { display: block; width: 100%; height: 28px; padding: 0 var(--s-3); border: 0; border-radius: var(--r-control); background: none; text-align: left; white-space: nowrap; }
.choice:hover, .choice:focus-visible { background: var(--hover); outline: none; }
.choice:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
</style>
