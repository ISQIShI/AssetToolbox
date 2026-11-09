<script setup lang="ts">
// 恢复预览：按状态筛选、搜索、勾选。筛选只影响显示，隐藏的勾选仍保留并提示数量。
import { computed, ref, watch } from 'vue';
import type { RestoreFile, RestorePreview, RestoreScope, Selection } from '../core/types';
import { bytes, initialSelection, selectionPayload, visibleFiles } from '../core/model';

const props = defineProps<{ preview: RestorePreview; scope: RestoreScope; disabled?: boolean }>();
const emit = defineEmits<{ restore: [selection: Selection[]]; recheck: [] }>();
const PAGE = 100;
const filter = ref<'all' | RestoreFile['state']>('all');
const search = ref('');
const page = ref(1);
const selected = ref(new Set<string>());

watch(() => props.preview, (preview, previous) => {
    // 重新检查后：之前出现过的可选文件沿用用户勾选，新出现的按范围默认勾选。
    const defaults = initialSelection(preview.files, props.scope);
    const known = new Set(previous?.files.filter(file => file.selectable).map(file => file.path));
    selected.value = new Set(preview.files.filter(file => file.selectable && (known.has(file.path) ? selected.value.has(file.path) : defaults.has(file.path))).map(file => file.path));
    page.value = 1;
}, { immediate: true });
watch([filter, search], () => { page.value = 1; });

const locked = computed(() => props.disabled || props.preview.cancelled);
const visible = computed(() => visibleFiles(props.preview.files, filter.value, search.value));
const pages = computed(() => Math.max(1, Math.ceil(visible.value.length / PAGE)));
const rows = computed(() => visible.value.slice((page.value - 1) * PAGE, page.value * PAGE));
const hidden = computed(() => selected.value.size - visible.value.filter(file => selected.value.has(file.path)).length);
const filters = computed(() => [
    { id: 'all', label: '全部', count: props.preview.files.length },
    { id: 'recoverable', label: '可恢复', count: props.preview.recoverable },
    { id: 'restored', label: '已恢复', count: props.preview.restored },
    { id: 'conflict', label: '冲突', count: props.preview.conflict },
] as const);
const labels: Record<RestoreFile['state'], { label: string; tone: string }> = {
    recoverable: { label: '可恢复', tone: 'neutral' }, restored: { label: '已恢复', tone: 'ok' }, conflict: { label: '冲突', tone: 'danger' },
};

function toggle(path: string, checked: boolean) { const copy = new Set(selected.value); if (checked) copy.add(path); else copy.delete(path); selected.value = copy; }
function selectVisible(checked: boolean) {
    const copy = new Set(selected.value);
    for (const file of visible.value) if (file.selectable) { if (checked) copy.add(file.path); else copy.delete(file.path); }
    selected.value = copy;
}
</script>

<template>
  <section class="restore-table" aria-label="恢复前检查结果">
    <header class="head">
      <dl class="facts">
        <dt>备份</dt><dd class="path">{{ preview.source }}</dd>
        <dt>恢复到</dt><dd class="path">{{ preview.destination }}</dd>
      </dl>
      <button type="button" class="button" :disabled="disabled" @click="emit('recheck')">重新检查</button>
    </header>

    <p v-if="preview.cancelled" class="callout warn">检查已取消，只检查了 {{ preview.checked }} / {{ preview.total }} 个文件。重新检查完成后才能恢复。</p>
    <p v-else-if="scope !== 'all'" class="callout">已默认勾选上次恢复中{{ scope === 'retry' ? '失败' : '未完成' }}的文件，可以继续调整。</p>

    <div class="toolbar">
      <div class="filters" role="radiogroup" aria-label="按状态筛选">
        <label v-for="item in filters" :key="item.id" class="filter" :class="{ chosen: filter === item.id }">
          <input v-model="filter" type="radio" name="restore-filter" :value="item.id" class="visually-hidden">
          {{ item.label }} <span class="count">{{ item.count }}</span>
        </label>
      </div>
      <input v-model="search" class="input search" type="search" aria-label="搜索恢复文件" placeholder="搜索路径或说明">
    </div>

    <div class="scroller">
      <table class="table">
        <thead><tr><th class="pick"><span class="visually-hidden">勾选</span></th><th>文件</th><th>状态</th><th class="number">当前 / 备份</th></tr></thead>
        <tbody>
          <tr v-for="file in rows" :key="file.path" :class="{ chosen: selected.has(file.path) }">
            <td class="pick"><input type="checkbox" :aria-label="`恢复 ${file.path}`" :checked="selected.has(file.path)" :disabled="locked || !file.selectable" @change="toggle(file.path, ($event.target as HTMLInputElement).checked)"></td>
            <td class="file"><span class="path">{{ file.path }}</span><span class="small muted">{{ file.reason }}</span></td>
            <td><span class="tone" :class="labels[file.state].tone">{{ labels[file.state].label }}</span></td>
            <td class="number">{{ bytes(file.currentBytes) }} / {{ bytes(file.backupBytes) }}</td>
          </tr>
          <tr v-if="!rows.length"><td colspan="4" class="muted">没有符合条件的文件。</td></tr>
        </tbody>
      </table>
    </div>

    <footer class="foot">
      <p class="tally">已勾选 <strong>{{ selected.size }}</strong> 项<span v-if="hidden" class="tone warn">，其中 {{ hidden }} 项被筛选隐藏</span>，当前列表 {{ visible.length }} 项</p>
      <div class="paging">
        <button type="button" class="button small" :disabled="page <= 1" @click="page--">上一页</button>
        <span class="small">{{ page }} / {{ pages }}</span>
        <button type="button" class="button small" :disabled="page >= pages" @click="page++">下一页</button>
      </div>
      <div class="bulk">
        <button type="button" class="button small" :disabled="locked" @click="selectVisible(true)">勾选全部筛选结果</button>
        <button type="button" class="button small" :disabled="disabled" @click="selectVisible(false)">取消勾选筛选结果</button>
      </div>
      <div class="commit">
        <p class="small muted">冲突和已恢复的文件不能勾选。写入前会再次核对哈希，备份始终保留。</p>
        <button type="button" class="button primary" :disabled="locked || !selected.size" @click="emit('restore', selectionPayload(preview.files, selected))">恢复所选 {{ selected.size }} 项</button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.restore-table { display: flex; flex-direction: column; gap: var(--s-4); min-height: 0; }
.restore-table > * { flex: none; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: var(--s-4); }
.facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--s-1) var(--s-4); margin: 0; min-width: 0; }
.facts dt { color: var(--ink-2); }
.facts dd { margin: 0; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); flex-wrap: wrap; }
.filters { display: flex; border: 1px solid var(--rule); border-radius: var(--r-control); overflow: hidden; }
.filter { display: inline-flex; align-items: center; gap: var(--s-2); padding: var(--s-1) var(--s-3); cursor: pointer; border-right: 1px solid var(--rule); background: var(--paper); }
.filter:last-child { border-right: 0; }
.filter.chosen { background: var(--ink); color: var(--paper); }
.filter:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: -2px; }
.count { font-size: var(--t-small); opacity: 0.75; }
.search { max-width: 280px; }
.restore-table > .scroller { flex: 1; min-height: 160px; overflow: auto; border: 1px solid var(--rule); }
.pick { width: 40px; }
.file { display: grid; gap: 2px; min-width: 0; }
tr.chosen td { background: var(--focus-wash); }
.foot { display: grid; grid-template-columns: 1fr auto; gap: var(--s-3) var(--s-4); align-items: center; }
.paging { display: flex; align-items: center; gap: var(--s-2); }
.bulk { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.commit { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); padding-top: var(--s-3); border-top: 1px solid var(--rule-soft); }
</style>
