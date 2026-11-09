<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { RestorePreview, RestoreScope, Selection } from './types';
import { bytes, initialSelection, selectionPayload, visibleFiles } from './model';
const props = defineProps<{ preview: RestorePreview; scope: RestoreScope; disabled?: boolean }>();
const emit = defineEmits<{ restore: [selection: Selection[]]; refresh: [] }>();
const filter = ref('all'), search = ref(''), page = ref(1), selected = ref(new Set<string>());
watch(() => props.preview, (preview, previous) => {
    const defaults = initialSelection(preview.files, props.scope);
    const previousSelectable = new Set(previous?.files.filter(file => file.selectable).map(file => file.path));
    selected.value = new Set(preview.files.filter(file => file.selectable && (previousSelectable.has(file.path) ? selected.value.has(file.path) : defaults.has(file.path))).map(file => file.path));
    page.value = 1;
}, { immediate: true });
const visible = computed(() => visibleFiles(props.preview.files, filter.value, search.value));
const pageCount = computed(() => Math.max(1, Math.ceil(visible.value.length / 100)));
const rows = computed(() => visible.value.slice((page.value - 1) * 100, page.value * 100));
const hiddenCount = computed(() => selected.value.size - visible.value.filter(file => selected.value.has(file.path)).length);
watch([filter, search], () => { page.value = 1; });
function toggle(path: string, checked: boolean) { const copy = new Set(selected.value); checked ? copy.add(path) : copy.delete(path); selected.value = copy; }
function selectVisible(checked: boolean) { const copy = new Set(selected.value); for (const file of visible.value) if (file.selectable) checked ? copy.add(file.path) : copy.delete(file.path); selected.value = copy; }
const labels = { recoverable: '可恢复', restored: '已恢复', conflict: '冲突' };
</script>
<template>
  <section class="panel restore-preview">
    <div class="section-heading"><div><h2>恢复前预览</h2><p>仅恢复勾选的文件。写入前会再次校验备份和目标内容。</p></div><button :disabled="disabled" @click="emit('refresh')">刷新预览</button></div>
    <div class="path-summary"><span>备份</span><code>{{ preview.source }}</code><span>目标</span><code>{{ preview.destination }}</code></div>
    <div class="stat-row"><div><strong>{{ preview.recoverable }}</strong><span>可恢复</span></div><div><strong>{{ preview.restored }}</strong><span>已恢复</span></div><div><strong>{{ preview.conflict }}</strong><span>冲突</span></div></div>
    <p v-if="preview.cancelled" class="notice warning">预览已取消，尚未检查所有文件。请刷新完成预览后再恢复。</p>
    <p v-if="scope !== 'all'" class="notice">当前默认勾选上次选择中的{{ scope === 'retry' ? '失败项' : '未完成项' }}。也可在列表中调整。</p>
    <div class="table-toolbar"><input v-model="search" aria-label="搜索恢复文件" placeholder="搜索路径或说明…"><select v-model="filter" aria-label="恢复状态筛选"><option value="all">全部状态</option><option value="recoverable">可恢复</option><option value="restored">已恢复</option><option value="conflict">冲突</option></select><button :disabled="disabled || preview.cancelled" @click="selectVisible(true)">全选筛选结果</button><button :disabled="disabled" @click="selectVisible(false)">取消筛选结果</button></div>
    <div class="table-scroll"><table><thead><tr><th class="check-cell">选择</th><th>文件 / 说明</th><th>状态</th><th class="number">当前 → 备份</th></tr></thead><tbody>
      <tr v-for="file in rows" :key="file.path"><td><input type="checkbox" :aria-label="`恢复 ${file.path}`" :checked="selected.has(file.path)" :disabled="disabled || preview.cancelled || !file.selectable" @change="toggle(file.path, ($event.target as HTMLInputElement).checked)"></td><td class="file-cell"><strong>{{ file.path }}</strong><small>{{ file.reason }}</small></td><td><span class="badge" :class="file.state">{{ labels[file.state] }}</span></td><td class="number">{{ bytes(file.currentBytes) }} → {{ bytes(file.backupBytes) }}</td></tr>
      <tr v-if="!rows.length"><td colspan="4" class="empty">没有符合条件的文件</td></tr>
    </tbody></table></div>
    <footer class="table-footer"><span>已选 <b>{{ selected.size }}</b> 项<span v-if="hiddenCount">（{{ hiddenCount }} 项被筛选隐藏）</span> · 共 {{ visible.length }} 项</span><div class="actions"><button :disabled="page <= 1" @click="page--">上一页</button><span>{{ page }} / {{ pageCount }}</span><button :disabled="page >= pageCount" @click="page++">下一页</button></div></footer>
    <div class="restore-action"><p>冲突和已恢复文件不可勾选，备份文件始终保留。</p><button class="primary" :disabled="disabled || preview.cancelled || !selected.size" @click="emit('restore', selectionPayload(preview.files, selected))">恢复所选 {{ selected.size }} 项</button></div>
  </section>
</template>
