<script setup lang="ts">
// 恢复预览：按状态筛选、搜索、勾选。筛选只影响显示，隐藏的勾选仍保留并提示数量。
import { computed, ref, watch } from 'vue';
import type { RestoreFile, RestorePreview, RestoreScope, Selection } from '../core/types';
import { bytes, initialSelection, selectionPayload, visibleFiles } from '../core/model';
import Icon from './Icon.vue';

const props = defineProps<{ preview: RestorePreview; scope: RestoreScope; disabled?: boolean }>();
const emit = defineEmits<{ restore: [selection: Selection[], preview: RestorePreview]; recheck: [] }>();
const choices = defineModel<Map<string, boolean>>('choices', { default: () => new Map<string, boolean>() });
const PAGE = 100;
const filter = ref<'all' | RestoreFile['state']>('all');
const search = ref('');
const page = ref(1);
const selected = computed(() => {
    const paths = initialSelection(props.preview.files, props.scope);
    for (const file of props.preview.files) {
        const choice = choices.value.get(file.path);
        if (choice === false) paths.delete(file.path);
        else if (choice && file.selectable) paths.add(file.path);
    }
    return paths;
});
watch([filter, search, () => props.preview], () => { page.value = 1; });

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
    recoverable: { label: '可恢复', tone: '' }, restored: { label: '已恢复', tone: 'ok' }, conflict: { label: '冲突', tone: 'danger' },
};

function toggle(path: string, checked: boolean) { choices.value = new Map(choices.value).set(path, checked); }
function selectVisible(checked: boolean) {
    const copy = new Map(choices.value);
    for (const file of visible.value) if (file.selectable) copy.set(file.path, checked);
    choices.value = copy;
}
</script>

<template>
  <section class="restore-table" aria-label="恢复前检查结果">
    <header class="head">
      <dl class="facts">
        <dt>备份</dt><dd class="path">{{ preview.source }}</dd>
        <dt>恢复到</dt><dd class="path">{{ preview.destination }}</dd>
      </dl>
      <button type="button" class="button" :disabled="disabled" @click="emit('recheck')"><Icon name="refresh" />重新检查</button>
    </header>

    <p v-if="preview.cancelled" class="callout warn"><Icon name="alert" class="tone warn" /><span>检查已取消，只检查了 {{ preview.checked }} / {{ preview.total }} 个文件。重新检查完成后才能恢复。</span></p>
    <p v-else-if="scope !== 'all'" class="callout">已默认勾选上次恢复中{{ scope === 'retry' ? '失败' : '未完成' }}的文件，可以继续调整。</p>

    <div class="toolbar">
      <div class="segmented filters" role="radiogroup" aria-label="按状态筛选">
        <label v-for="item in filters" :key="item.id" class="filter" :class="{ chosen: filter === item.id }">
          <input v-model="filter" type="radio" name="restore-filter" :value="item.id" class="visually-hidden">
          {{ item.label }} <span class="count">{{ item.count }}</span>
        </label>
      </div>
      <div class="bulk">
        <button type="button" class="button small" :disabled="locked" @click="selectVisible(true)">勾选全部筛选结果</button>
        <button type="button" class="button small" :disabled="disabled" @click="selectVisible(false)">取消勾选筛选结果</button>
      </div>
      <input v-model="search" class="input search" type="search" aria-label="搜索恢复文件" placeholder="搜索路径或说明">
    </div>

    <div class="scroller">
      <table class="table">
        <thead><tr><th class="pick"><span class="visually-hidden">勾选</span></th><th>文件</th><th>说明</th><th>状态</th><th class="number">当前 / 备份</th></tr></thead>
        <tbody>
          <tr v-for="file in rows" :key="file.path" :class="{ chosen: selected.has(file.path) }">
            <td class="pick"><input type="checkbox" :aria-label="`恢复 ${file.path}`" :checked="selected.has(file.path)" :disabled="locked || !file.selectable" @change="toggle(file.path, ($event.target as HTMLInputElement).checked)"></td>
            <td class="path">{{ file.path }}</td>
            <td class="small muted">{{ file.reason }}</td>
            <td><span class="badge" :class="labels[file.state].tone">{{ labels[file.state].label }}</span></td>
            <td class="number">{{ bytes(file.currentBytes) }} / {{ bytes(file.backupBytes) }}</td>
          </tr>
          <tr v-if="!rows.length"><td colspan="5" class="muted">没有符合条件的文件。</td></tr>
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
      <div class="commit">
        <p class="small muted">冲突和已恢复的文件不能勾选。写入前会再次核对哈希，备份始终保留。</p>
        <button type="button" class="button primary" :disabled="locked || !selected.size" @click="emit('restore', selectionPayload(preview.files, selected), preview)">恢复所选 {{ selected.size }} 项</button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
/* 上：来源与筛选工具栏；中：独立滚动的数据表；下：勾选计数、分页与恢复命令 */
.restore-table { display: flex; flex-direction: column; min-height: 0; }
.restore-table > * { flex: none; }
.head { display: flex; justify-content: space-between; align-items: center; gap: var(--s-4); padding: var(--s-3) var(--s-4) 0; }
.facts { min-width: 0; }
.restore-table > .callout { margin: var(--s-2) var(--s-4) 0; }
.toolbar { display: flex; align-items: center; gap: var(--s-2) var(--s-3); flex-wrap: wrap; padding: var(--s-3) var(--s-4); }
.count { font-size: var(--t-small); color: var(--text-2); font-weight: 400; }
.bulk { display: flex; gap: var(--s-1); flex-wrap: wrap; }
.search { flex: 1 1 160px; max-width: 260px; margin-left: auto; }
.restore-table > .scroller { flex: 1; min-height: 96px; overflow: auto; border-top: 1px solid var(--border-soft); border-bottom: 1px solid var(--border-soft); background: var(--control); }
.pick { width: 36px; padding-right: 0 !important; }
tr.chosen td { background-color: var(--accent-wash); }
.foot { display: grid; grid-template-columns: 1fr auto; gap: var(--s-2) var(--s-4); align-items: center; padding: var(--s-2) var(--s-4) var(--s-3); background: var(--pane); }
.paging { display: flex; align-items: center; gap: var(--s-2); }
.commit { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: var(--s-4); }
</style>
