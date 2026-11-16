<script setup lang="ts">
// 恢复页：先选备份来源（任务备份或独立备份），检查后再勾选要恢复的文件。
import { computed, ref, watch } from 'vue';
import { useWorkbench } from '../core/workbench';
import { date, folderName } from '../core/model';
import PathField from '../components/PathField.vue';
import RestoreTable from '../components/RestoreTable.vue';
import Icon from '../components/Icon.vue';
import SelectBox from '../components/SelectBox.vue';

const bench = useWorkbench();
const { tasks, restoreSource, restorePreview, restoreScope, restoreRevision, busy, job } = bench;

const mode = ref<'task' | 'export'>(restoreSource.value?.kind || 'task');
const taskId = ref(restoreSource.value?.kind === 'task' ? restoreSource.value.taskId : '');
const backupDir = ref(restoreSource.value?.kind === 'export' ? restoreSource.value.backupDir : '');
const outputDir = ref(restoreSource.value?.kind === 'export' ? restoreSource.value.outputDir : '');
const backedUp = computed(() => tasks.value.filter(task => task.backupCount > 0));
watch(restoreSource, source => { if (source?.kind === 'task') { mode.value = 'task'; taskId.value = source.taskId; } });
// 选中任务就开始检查，不用再点一次按钮；同一任务已有结果或正在检查时不重复提交。
watch(taskId, id => {
    const current = restoreSource.value?.kind === 'task' && restoreSource.value.taskId === id && Boolean(restorePreview.value);
    if (id && mode.value === 'task' && !busy.value && !current) check();
});

function check() {
    if (mode.value === 'task') {
        if (!taskId.value) { bench.error.value = '请选择一个有备份的任务'; return; }
        void bench.checkRestore({ kind: 'task', taskId: taskId.value });
    } else {
        if (!backupDir.value.trim() || !outputDir.value.trim()) { bench.error.value = '请选择备份文件夹和恢复目标文件夹'; return; }
        void bench.checkRestore({ kind: 'export', backupDir: backupDir.value.trim(), outputDir: outputDir.value.trim() });
    }
}
</script>

<template>
  <div class="restore">
    <section class="source" aria-label="备份来源">
      <fieldset class="segmented modes" :disabled="busy">
        <legend class="visually-hidden">备份来源</legend>
        <label class="mode" :class="{ chosen: mode === 'task' }"><input v-model="mode" type="radio" value="task" class="visually-hidden">任务的备份</label>
        <label class="mode" :class="{ chosen: mode === 'export' }"><input v-model="mode" type="radio" value="export" class="visually-hidden">独立备份文件夹</label>
      </fieldset>

      <div v-if="mode === 'task'" class="inputs">
        <div class="field stacked grow">
          <label class="label" for="restore-task">任务</label>
          <SelectBox id="restore-task" v-model="taskId" :options="backedUp.map(task => ({ value: task.id, label: `${task.source ? folderName(task.source) : task.id}，${date(task.createdAt)}，备份 ${task.backupCount} 个` }))" :placeholder="backedUp.length ? '选择一个有备份的任务' : '还没有启用备份的任务'" :disabled="busy || !backedUp.length" />
        </div>
        <button type="button" class="button" :disabled="busy || !taskId" @click="check"><Icon name="refresh" />重新检查</button>
      </div>
      <div v-else class="inputs">
        <PathField v-model="backupDir" class="grow" stacked label="备份文件夹" dialog-title="选择备份批次文件夹" :disabled="busy" />
        <PathField v-model="outputDir" class="grow" stacked label="恢复目标文件夹" dialog-title="选择恢复目标文件夹" :disabled="busy" />
        <button type="button" class="button primary" :disabled="busy" @click="check"><Icon name="scan" />检查独立备份</button>
      </div>
      <p v-if="mode === 'export'" class="small muted">选择包含原始文件的备份批次文件夹。目标中内容不同的文件会标为冲突，不会被覆盖。</p>
    </section>

    <section class="body">
      <RestoreTable v-if="restorePreview" :key="restoreRevision" :preview="restorePreview" :scope="restoreScope" :disabled="busy" @restore="bench.restoreSelected" @recheck="bench.recheckRestore()" />
      <p v-else-if="job?.kind === 'restore-check' && !job.state.done" class="empty muted">正在比较备份和目标中的文件…</p>
      <div v-else class="empty">
        <Icon name="restore" :size="28" />
        <h2>{{ mode === 'task' ? '选择一个任务，查看它备份了哪些文件' : '选择备份文件夹和恢复目标' }}</h2>
        <p class="muted">检查会逐个比较备份和目标中的文件，分为可恢复、已恢复和冲突三类。只恢复你勾选的文件，备份本身不会被修改或删除。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.restore { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; }
.source { display: grid; justify-items: start; gap: var(--s-2); padding: var(--s-3) var(--s-4); background: var(--pane); border-bottom: 1px solid var(--border-soft); }
.inputs { display: flex; align-items: flex-end; gap: var(--s-3); flex-wrap: wrap; width: 100%; }
.grow { flex: 1 1 240px; }
.body { min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.body > * { flex: 1; min-height: 0; }
.empty { display: grid; align-content: center; justify-items: center; gap: var(--s-2); max-width: 52ch; margin: 0 auto; padding: var(--pane-padding); text-align: center; }
.empty .icon { color: var(--text-3); }
.empty h2 { font-size: var(--t-title); letter-spacing: 0; }
</style>
