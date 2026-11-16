<script setup lang="ts">
// 处理线：来源 → 各步骤 → 写入 →（扫描结果）。文件沿竖线自上而下经过每个站点，编号即执行顺序。
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue';
import { useWorkbench } from '../core/workbench';
import { folderName, isMissing, providerOf, stepGroups, stepTitle } from '../core/model';
import type { ResourceType } from '../core/types';
import { resourceGroups, resourceKindLabel } from '../core/resource-groups';
import Icon from './Icon.vue';
import Tip from './Tip.vue';

const bench = useWorkbench();
const { config, definition, station, scan, scanStale, busy } = bench;
const adding = ref(false);
const addButton = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const menuStyle = ref<Record<string, string>>({});
const menuId = useId();
const search = ref<HTMLInputElement>();
const query = ref('');
const operationId = ref('');

const groups = computed(() => definition.value ? stepGroups(definition.value) : []);
const selectedGroup = computed(() => groups.value.find(group => group.operation.id === operationId.value));
const term = computed(() => query.value.trim().toLocaleLowerCase());
const matches = (value: string) => value.toLocaleLowerCase().includes(term.value);
const matchesType = (type: ResourceType) => matches([resourceKindLabel(type.kind), type.kind, type.displayName, type.id, ...type.extensions].join(' '));
const filteredGroups = computed(() => groups.value.filter(group => matches(`${group.operation.displayName} ${group.operation.id}`) || group.resourceTypes.some(matchesType)));
const filteredTypes = computed(() => selectedGroup.value?.resourceTypes.filter(matchesType) || []);
const typeGroups = computed(() => resourceGroups(filteredTypes.value));
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

// 分两级选择，避免将格式与操作的组合全部平铺；搜索只影响选择器，不改变目录与配置。
function outside(event: Event) {
    const target = event.target as Node;
    if (!menu.value?.contains(target) && !addButton.value?.contains(target)) close(false);
}
function open() {
    const rect = addButton.value!.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom;
    const left = `${Math.max(12, Math.min(rect.left + 8, window.innerWidth - 332))}px`;
    menuStyle.value = below >= 360 || below >= rect.top
        ? { left, top: `${rect.bottom + 2}px`, maxHeight: `${Math.min(360, below - 12)}px` }
        : { left, bottom: `${window.innerHeight - rect.top + 2}px`, maxHeight: `${Math.min(360, rect.top - 12)}px` };
    operationId.value = '';
    query.value = '';
    adding.value = true;
    void nextTick(() => search.value?.focus());
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
function choose(resourceType: string, operation: string) { bench.addStep(resourceType, operation); close(true); }
function selectOperation(id: string) {
    operationId.value = id;
    query.value = '';
    void nextTick(() => search.value?.focus());
}
function focusOut(event: FocusEvent) {
    if (event.relatedTarget && event.relatedTarget !== addButton.value && !menu.value?.contains(event.relatedTarget as Node)) close(false);
}
function menuKey(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' && selectedGroup.value && document.activeElement !== search.value) {
        event.preventDefault(); selectOperation(''); return;
    }
    const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp';
    const edge = event.key === 'Home' || event.key === 'End';
    if (!arrow && !(edge && document.activeElement !== search.value)) return;
    event.preventDefault();
    const items = Array.from(menu.value!.querySelectorAll<HTMLButtonElement>('.choice'));
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : index < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[target]?.focus();
}
watch([busy, full], ([isBusy, isFull]) => { if (isBusy || isFull) close(false); });
onUnmounted(() => close(false));
</script>

<template>
  <nav class="rail" aria-label="处理顺序" @scroll.self="dismiss">
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
        <button ref="addButton" type="button" class="station-button" aria-haspopup="dialog" :aria-controls="menuId" :aria-expanded="adding" :disabled="busy || full || !groups.length" @click="adding ? close(false) : open()">
          <span class="node plus" aria-hidden="true"><Icon name="plus" :size="12" /></span>
          <span class="text"><span class="title">添加步骤</span><span v-if="full" class="sub">已达到 64 步上限</span></span>
        </button>
        <section v-if="adding" :id="menuId" ref="menu" class="step-picker" :style="menuStyle" role="dialog" aria-label="添加步骤" @focusout="focusOut" @keydown.esc.stop.prevent="close(true)" @keydown="menuKey">
          <div class="picker-heading">
            <Tip v-if="selectedGroup" text="返回操作列表"><button type="button" class="button quiet small icon-only" aria-label="返回操作列表" @click="selectOperation('')"><Icon class="back" name="chevron" /></button></Tip>
            <strong>{{ selectedGroup ? selectedGroup.operation.displayName : '选择操作' }}</strong>
            <span>{{ selectedGroup ? '选择资源格式' : '再选资源格式' }}</span>
          </div>
          <div class="picker-search">
            <input ref="search" v-model="query" class="input" type="search" :aria-label="selectedGroup ? '搜索资源格式' : '搜索操作或格式'" :placeholder="selectedGroup ? '搜索类别或格式…' : '搜索操作、类别或格式…'" />
          </div>
          <ul class="choices" :aria-label="selectedGroup ? '资源格式' : '处理操作'">
            <template v-if="!selectedGroup">
              <li v-for="group in filteredGroups" :key="group.operation.id">
                <button type="button" class="choice" :aria-label="group.operation.displayName" :title="group.operation.description" @click="selectOperation(group.operation.id)">
                  <span class="choice-text"><span>{{ group.operation.displayName }}</span><small>{{ resourceGroups(group.resourceTypes).map(category => `${category.label} · ${category.items.map(type => type.displayName).join('、')}`).join(' / ') }}</small></span>
                  <Icon name="chevron" :size="12" />
                </button>
              </li>
            </template>
            <template v-else>
              <li v-for="group in typeGroups" :key="group.id" class="format-group">
                <p class="category-title">{{ group.label }}<span>{{ group.items.length }} 种格式</span></p>
                <ul :aria-label="group.label">
                <li v-for="type in group.items" :key="type.id"><button type="button" class="choice" :aria-label="type.displayName" @click="choose(type.id, selectedGroup!.operation.id)">
                  <span class="choice-text"><span>{{ type.displayName }}</span><small class="extensions">{{ type.extensions.join('、') }}</small></span>
                  <Icon name="plus" :size="12" />
                </button></li>
                </ul>
              </li>
            </template>
          </ul>
          <p v-if="!(selectedGroup ? filteredTypes.length : filteredGroups.length)" class="picker-empty" role="status">没有匹配项，试试其他关键词。</p>
        </section>
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

/* 定高上限，只滚动选项，标题与搜索始终可见。 */
.step-picker { position: fixed; z-index: 20; display: flex; flex-direction: column; width: 320px; max-width: calc(100vw - 24px); padding: var(--s-1); border: 1px solid var(--border-soft); border-radius: var(--r-float); background: var(--control); box-shadow: var(--shadow-float); }
.picker-heading { display: flex; flex-shrink: 0; align-items: center; gap: var(--s-2); min-height: var(--control-height); padding: 0 var(--s-2); }
.picker-heading strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.picker-heading > span { margin-left: auto; flex-shrink: 0; font-size: var(--t-small); color: var(--text-2); }
.back { transform: rotate(180deg); }
.picker-search { flex-shrink: 0; padding: var(--s-1) var(--s-2) var(--s-2); }
.picker-search input { width: 100%; }
.choices { list-style: none; min-height: 0; margin: 0; padding: 0; overflow-y: auto; overscroll-behavior: contain; }
.format-group > ul { list-style: none; margin: 0; padding: 0; }
.category-title { display: flex; justify-content: space-between; gap: var(--s-2); padding: var(--s-1) var(--s-2); background: var(--pane); color: var(--text-2); font-size: var(--t-small); }
.category-title > span { font-weight: 400; }
.choice { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); width: 100%; min-height: 44px; padding: var(--s-1) var(--s-2); border: 0; border-radius: var(--r-control); background: none; text-align: left; }
.choice-text { display: grid; min-width: 0; }
.choice-text > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.choice small { color: var(--text-2); font-size: var(--t-small); }
.extensions { font-family: var(--font-mono); }
.choice > .icon { flex-shrink: 0; color: var(--text-2); }
.choice:hover, .choice:focus-visible { background: var(--hover); outline: none; }
.choice:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
.picker-empty { margin: 0; padding: var(--s-3) var(--s-2); color: var(--text-2); }
</style>
