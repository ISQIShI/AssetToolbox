<script setup lang="ts">
// 恢复页：先选备份来源（任务备份或独立备份），检查后再勾选要恢复的文件。
import { computed, ref, watch } from 'vue';
import { useWorkbench } from '../core/workbench';
import { date, folderName } from '../core/model';
import PathField from '../components/PathField.vue';
import RestoreTable from '../components/RestoreTable.vue';

const bench = useWorkbench();
const { tasks, restoreSource, restorePreview, restoreScope, restoreRevision, busy } = bench;

const mode = ref<'task' | 'export'>(restoreSource.value?.kind || 'task');
const taskFile = ref(restoreSource.value?.kind === 'task' ? restoreSource.value.taskFile : '');
const backupDir = ref(restoreSource.value?.kind === 'export' ? restoreSource.value.backupDir : '');
const outputDir = ref(restoreSource.value?.kind === 'export' ? restoreSource.value.outputDir : '');
const backedUp = computed(() => tasks.value.filter(task => task.backupCount > 0));
watch(restoreSource, source => { if (source?.kind === 'task') { mode.value = 'task'; taskFile.value = source.taskFile; } });

function check() {
    if (mode.value === 'task') {
        if (!taskFile.value) { bench.error.value = '请选择一个有备份的任务'; return; }
        void bench.checkRestore({ kind: 'task', taskFile: taskFile.value });
    } else {
        if (!backupDir.value.trim() || !outputDir.value.trim()) { bench.error.value = '请选择备份文件夹和恢复目标文件夹'; return; }
        void bench.checkRestore({ kind: 'export', backupDir: backupDir.value.trim(), outputDir: outputDir.value.trim() });
    }
}
</script>

<template>
  <div class="restore">
    <section class="source" aria-label="备份来源">
      <fieldset class="modes" :disabled="busy">
        <legend class="visually-hidden">备份来源</legend>
        <label class="mode" :class="{ chosen: mode === 'task' }"><input v-model="mode" type="radio" value="task" class="visually-hidden">任务的备份</label>
        <label class="mode" :class="{ chosen: mode === 'export' }"><input v-model="mode" type="radio" value="export" class="visually-hidden">独立备份文件夹</label>
      </fieldset>

      <div v-if="mode === 'task'" class="inputs">
        <div class="field grow">
          <label class="label" for="restore-task">任务</label>
          <select id="restore-task" v-model="taskFile" class="select" :disabled="busy || !backedUp.length">
            <option value="" disabled>{{ backedUp.length ? '选择一个有备份的任务' : '还没有启用备份的任务' }}</option>
            <option v-for="task in backedUp" :key="task.taskFile" :value="task.taskFile">{{ task.source ? folderName(task.source) : task.id }}，{{ date(task.createdAt) }}，备份 {{ task.backupCount }} 个</option>
          </select>
        </div>
        <button type="button" class="button primary" :disabled="busy" @click="check">检查备份</button>
      </div>
      <div v-else class="inputs">
        <PathField v-model="backupDir" class="grow" label="备份文件夹" dialog-title="选择备份批次文件夹" :disabled="busy" />
        <PathField v-model="outputDir" class="grow" label="恢复目标文件夹" dialog-title="选择恢复目标文件夹" :disabled="busy" />
        <button type="button" class="button primary" :disabled="busy" @click="check">检查独立备份</button>
      </div>
      <p v-if="mode === 'export'" class="small muted">选择包含原始文件的备份批次文件夹。目标中内容不同的文件会标为冲突，不会被覆盖。</p>
    </section>

    <section class="body">
      <RestoreTable v-if="restorePreview" :key="restoreRevision" :preview="restorePreview" :scope="restoreScope" :disabled="busy" @restore="bench.restoreSelected" @recheck="bench.recheckRestore()" />
      <div v-else-if="!busy" class="empty">
        <h2>恢复前先逐个核对</h2>
        <p class="muted">检查会比较备份和目标中的每个文件，分为可恢复、已恢复和冲突三类。只恢复你勾选的文件，备份本身不会被修改或删除。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.restore { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; }
.source { display: grid; gap: var(--s-3); padding: var(--s-4) var(--s-5); background: var(--canvas); border-bottom: 1px solid var(--rule); }
.modes { display: flex; gap: var(--s-5); margin: 0; padding: 0; border: 0; }
.mode { padding: var(--s-1) 0; border-bottom: 2px solid transparent; color: var(--ink-2); font-weight: 500; cursor: pointer; }
.mode.chosen { color: var(--ink); border-bottom-color: var(--ink); }
.mode:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 2px; }
.inputs { display: flex; align-items: flex-end; gap: var(--s-3); flex-wrap: wrap; }
.grow { flex: 1 1 260px; }
.body { min-height: 0; overflow: auto; padding: var(--s-5); background: var(--paper); display: flex; flex-direction: column; }
.body > * { flex: 1; min-height: 0; }
.empty { display: grid; align-content: start; gap: var(--s-3); max-width: 60ch; padding-top: var(--s-5); }
h2 { font-size: var(--t-heading); }
@media (max-width: 1000px) { .body { padding: var(--s-4); } }
@media (max-width: 560px) {
  .restore { overflow-y: auto; display: block; }
  .source, .body { padding: var(--s-4); }
  .grow { flex-basis: 100%; }
}
</style>
