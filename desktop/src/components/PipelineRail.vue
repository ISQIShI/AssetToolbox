<script setup lang="ts">
// 处理线：来源 → 各步骤 → 写入 →（扫描结果）。文件沿竖线自上而下经过每个站点，编号即执行顺序。
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue';
import { useWorkbench } from '../core/workbench';
import { folderName, isMissing, providerOf, stepGroups, stepTitle } from '../core/model';
import { resourceGroups } from '../core/resource-groups';
import Icon from './Icon.vue';
import Tip from './Tip.vue';
import StepMenu from './StepMenu.vue';
import { computePosition, flip, offset, shift, size } from '@floating-ui/dom';

const bench = useWorkbench();
const { config, definition, station, scan, scanStale, busy } = bench;
const adding = ref(false);
const addButton = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const menuStyle = ref<Record<string, string>>({});
const menuId = useId();
const search = ref<HTMLInputElement>();
const query = ref('');
const kindId = ref(''), typeId = ref('');
const groups = computed(() => definition.value ? stepGroups(definition.value) : []);
const categories = computed(() => resourceGroups((definition.value?.resourceTypes || []).filter(type => groups.value.some(group => group.resourceTypes.some(item => item.id === type.id)))));
const category = computed(() => categories.value.find(group => group.id === kindId.value));
const resourceType = computed(() => category.value?.items.find(type => type.id === typeId.value));
const stage = computed(() => resourceType.value ? '操作' : category.value ? '资源格式' : '资源分组');
const choices = computed(() => resourceType.value
    ? groups.value.filter(group => group.resourceTypes.some(type => type.id === typeId.value)).map(group => ({ id: group.operation.id, label: group.operation.displayName, description: group.operation.description }))
    : category.value ? category.value.items.map(type => ({ id: type.id, label: type.displayName, description: type.extensions.join('、') }))
        : categories.value.map(group => ({ id: group.id, label: group.label, description: group.items.map(type => type.displayName).join('、') })));
const filteredChoices = computed(() => choices.value.filter(item => [item.id, item.label, item.description].join(' ').toLocaleLowerCase().includes(query.value.trim().toLocaleLowerCase())));
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

// 先分组、再格式、最后操作；只有最后一级才创建步骤。
function outside(event: Event) {
    const target = event.target as Node;
    if (!menu.value?.contains(target) && !addButton.value?.contains(target)) close(false);
}
// 按添加按钮定位：默认在下方左对齐，空间不足时翻到上方，并始终留在窗口内；高度不超过可用空间。
async function place() {
    if (!addButton.value || !menu.value) return;
    const { x, y } = await computePosition(addButton.value, menu.value, {
        strategy: 'fixed', placement: 'bottom-start',
        middleware: [offset({ mainAxis: 2, crossAxis: 8 }), flip({ padding: 8 }), shift({ padding: 8 }),
            size({ padding: 8, apply: ({ availableHeight }) => { menuStyle.value = { ...menuStyle.value, maxHeight: `${Math.max(160, Math.min(360, availableHeight))}px` }; } })],
    });
    menuStyle.value = { ...menuStyle.value, left: `${x}px`, top: `${y}px` };
}
function open() {
    menuStyle.value = { left: '0px', top: '0px', maxHeight: '360px' };
    kindId.value = ''; typeId.value = '';
    query.value = '';
    adding.value = true;
    void nextTick(() => { void place(); search.value?.focus(); });
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
function enter(id: string) {
    if (resourceType.value) { choose(typeId.value, id); return; }
    if (category.value) typeId.value = id; else kindId.value = id;
    query.value = ''; void nextTick(() => search.value?.focus());
}
function back() {
    if (typeId.value) typeId.value = ''; else kindId.value = '';
    query.value = ''; void nextTick(() => search.value?.focus());
}
watch([kindId, typeId, query], () => { if (adding.value) void nextTick(place); });
function focusOut(event: FocusEvent) {
    if (event.relatedTarget && event.relatedTarget !== addButton.value && !menu.value?.contains(event.relatedTarget as Node)) close(false);
}
function menuKey(event: KeyboardEvent) {
    if (event.key === 'ArrowLeft' && category.value && document.activeElement !== search.value) {
        event.preventDefault(); back(); return;
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

// ---------- 步骤排序：拖拽（指针）与 Alt+上/下（键盘）----------
// 拖动超过阈值后才进入排序，按指针所在位置实时移动步骤；松开后吞掉这次点击，避免误切换选中项。
const DRAG_THRESHOLD = 5;
const line = ref<HTMLElement>();
const draggingId = ref<string>();
let drag: { id: string; startY: number; moved: boolean } | undefined;
const indexOfStep = (id: string) => config.value?.pipeline.findIndex(step => step.id === id) ?? -1;
function dragMove(event: PointerEvent) {
    if (!drag || !line.value) return;
    if (!drag.moved) {
        if (Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD) return;
        drag.moved = true; draggingId.value = drag.id;
    }
    const from = indexOfStep(drag.id);
    const items = Array.from(line.value.querySelectorAll<HTMLElement>('[data-step-id]'));
    if (from < 0 || !items.length) return;
    // 目标位置：指针越过哪个步骤的中线，就排到它的那一侧。
    let to = from;
    items.forEach((item, index) => {
        const rect = item.getBoundingClientRect(), middle = rect.top + rect.height / 2;
        if (index < from && event.clientY < middle) to = Math.min(to, index);
        if (index > from && event.clientY > middle) to = Math.max(to, index);
    });
    if (to !== from) bench.moveStepTo(from, to);
}
function dragEnd() {
    window.removeEventListener('pointermove', dragMove);
    window.removeEventListener('pointerup', dragEnd);
    window.removeEventListener('pointercancel', dragEnd);
    const moved = drag?.moved;
    drag = undefined; draggingId.value = undefined;
    if (!moved) return;
    // 吞掉紧随松开而来的那一次点击；它若没有发生（例如在窗口外松开），下一轮事件循环就撤销，避免误吞之后的点击。
    const swallow = (event: Event) => { event.stopPropagation(); event.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}
function dragStart(event: PointerEvent, id: string) {
    if (event.button !== 0 || busy.value || (config.value?.pipeline.length || 0) < 2) return;
    drag = { id, startY: event.clientY, moved: false };
    window.addEventListener('pointermove', dragMove);
    window.addEventListener('pointerup', dragEnd);
    window.addEventListener('pointercancel', dragEnd);
}
function stepKey(event: KeyboardEvent, id: string) {
    if (!event.altKey || busy.value || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    bench.moveStep(indexOfStep(id), event.key === 'ArrowUp' ? -1 : 1);
    void nextTick(() => target.focus());
}
onUnmounted(dragEnd);
onUnmounted(() => close(false));
</script>

<template>
  <nav class="rail" aria-label="处理顺序" @scroll.self="dismiss">
    <div class="rail-heading"><strong>处理线</strong><span>{{ steps.length }} 个步骤</span></div>
    <ol ref="line" class="line">
      <li class="station endpoint">
        <button type="button" class="station-button" data-station="source" :aria-current="station === 'source' ? 'true' : undefined" @click="station = 'source'">
          <span class="node" aria-hidden="true"></span>
          <span class="text"><span class="title">来源</span><span class="sub">{{ sourceLabel }}</span></span>
        </button>
      </li>

      <li v-for="(item, index) in steps" :key="item.key" class="station" :class="{ off: !item.step.enabled, missing: item.missing, dragging: draggingId === item.step.id }" :data-step-id="item.step.id">
        <StepMenu :index="index" :count="steps.length" :enabled="item.step.enabled" :disabled="busy" @select="station = item.key" @move="bench.moveStep(index, $event)" @toggle="bench.toggleStep(index)" @remove="bench.requestRemoveStep(index)">
          <button type="button" class="station-button" :aria-current="station === item.key ? 'true' : undefined" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" @click="station = item.key" @pointerdown="dragStart($event, item.step.id)" @keydown="stepKey($event, item.step.id)">
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
        </StepMenu>
      </li>

      <li class="station adder">
        <button ref="addButton" type="button" class="station-button" aria-haspopup="dialog" :aria-controls="menuId" :aria-expanded="adding" :disabled="busy || full || !groups.length" @click="adding ? close(false) : open()">
          <span class="node plus" aria-hidden="true"><Icon name="plus" :size="12" /></span>
          <span class="text"><span class="title">添加步骤</span><span v-if="full" class="sub">已达到 64 步上限</span></span>
        </button>
        <section v-if="adding" :id="menuId" ref="menu" class="step-picker" :style="menuStyle" role="dialog" aria-label="添加步骤" @focusout="focusOut" @keydown.esc.stop.prevent="close(true)" @keydown="menuKey">
          <div class="picker-heading">
            <button v-if="category" type="button" class="button quiet small icon-only" aria-label="返回上一级" @click="back"><Icon class="back" name="chevron" /></button>
            <strong>{{ resourceType?.displayName || category?.label || '添加步骤' }}</strong>
            <span>{{ resourceType ? '3 / 3' : category ? '2 / 3' : '1 / 3' }} · 选择{{ stage }}</span>
          </div>
          <p v-if="category" class="picker-path">{{ ['资源分组', category.label, resourceType?.displayName].filter(Boolean).join(' / ') }}</p>
          <div class="picker-search">
            <input ref="search" v-model="query" class="input" type="search" :aria-label="'搜索' + stage" :placeholder="'搜索' + stage + '…'" />
          </div>
          <ul class="choices" :aria-label="stage">
            <li v-for="item in filteredChoices" :key="item.id">
              <button type="button" class="choice" :aria-label="item.label" @click="enter(item.id)">
                <span class="choice-text"><span>{{ item.label }}</span><small>{{ item.description }}</small></span>
                <Icon :name="resourceType ? 'plus' : 'chevron'" :size="12" />
              </button>
            </li>
          </ul>
          <p v-if="!filteredChoices.length" class="picker-empty" role="status">没有匹配项，试试其他关键词。</p>
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
/* 拖拽中的步骤：抬起并标出强调色边框；其余步骤实时让位 */
.dragging .station-button { background: var(--control); box-shadow: 0 0 0 1px var(--accent), var(--shadow-float); cursor: grabbing; --ring: var(--control); }
.dragging { z-index: 4; }

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
.picker-path { padding: 0 var(--s-2) var(--s-1); color: var(--text-2); font-size: var(--t-small); }
.back { transform: rotate(180deg); }
.picker-search { flex-shrink: 0; padding: var(--s-1) var(--s-2) var(--s-2); }
.picker-search input { width: 100%; }
.choices { list-style: none; min-height: 0; margin: 0; padding: 0; overflow-y: auto; overscroll-behavior: contain; }
.choice { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); width: 100%; min-height: 44px; padding: var(--s-1) var(--s-2); border: 0; border-radius: var(--r-control); background: none; text-align: left; }
.choice-text { display: grid; min-width: 0; }
.choice-text > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.choice small { color: var(--text-2); font-size: var(--t-small); }
.choice > .icon { flex-shrink: 0; color: var(--text-2); }
.choice:hover, .choice:focus-visible { background: var(--hover); outline: none; }
.choice:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
.picker-empty { margin: 0; padding: var(--s-3) var(--s-2); color: var(--text-2); }
</style>
