<script setup lang="ts">
// 恢复页：先选备份来源（任务备份或独立备份），检查后再勾选要恢复的文件。
import { computed } from 'vue';
import { useWorkbench } from '../core/workbench';
import { date, folderName } from '../core/model';
import PathField from '../components/PathField.vue';
import RestoreTable from '../components/RestoreTable.vue';
import Icon from '../components/Icon.vue';
import SelectBox from '../components/SelectBox.vue';

const bench = useWorkbench();
const { tasks, restoreForm, restorePreview, restoreScope, restoreChoices, busy, job } = bench;
const backedUp = computed(() => tasks.value.filter(task => task.backupCount > 0));
</script>

<template>
  <div class="restore">
    <section class="source" aria-label="备份来源">
      <fieldset class="segmented modes" :disabled="busy">
        <legend class="visually-hidden">备份来源</legend>
        <label class="mode" :class="{ chosen: restoreForm.kind === 'task' }"><input v-model="restoreForm.kind" type="radio" value="task" class="visually-hidden">任务的备份</label>
        <label class="mode" :class="{ chosen: restoreForm.kind === 'export' }"><input v-model="restoreForm.kind" type="radio" value="export" class="visually-hidden">独立备份文件夹</label>
      </fieldset>

      <div v-if="restoreForm.kind === 'task'" class="inputs">
        <div class="field stacked grow">
          <label class="label" for="restore-task">任务</label>
          <SelectBox id="restore-task" :model-value="restoreForm.taskId" :options="backedUp.map(task => ({ value: task.id, label: `${task.source ? folderName(task.source) : task.id}，${date(task.createdAt)}，备份 ${task.backupCount} 个` }))" :placeholder="backedUp.length ? '选择一个有备份的任务' : '还没有启用备份的任务'" :disabled="busy || !backedUp.length" @update:model-value="bench.checkRestore({ kind: 'task', taskId: $event })" />
        </div>
        <button type="button" class="button" :disabled="busy || !restoreForm.taskId" @click="bench.recheckRestore()"><Icon name="refresh" />重新检查</button>
      </div>
      <div v-else class="inputs">
        <PathField v-model="restoreForm.backupDir" class="grow" stacked label="备份文件夹" dialog-title="选择备份批次文件夹" :disabled="busy" />
        <PathField v-model="restoreForm.outputDir" class="grow" stacked label="恢复目标文件夹" dialog-title="选择恢复目标文件夹" :disabled="busy" />
        <button type="button" class="button primary" :disabled="busy" @click="bench.recheckRestore()"><Icon name="scan" />检查独立备份</button>
      </div>
      <p v-if="restoreForm.kind === 'export'" class="small muted">选择包含原始文件的备份批次文件夹。目标中内容不同的文件会标为冲突，不会被覆盖。</p>
    </section>

    <section class="body">
      <RestoreTable v-if="restorePreview" v-model:choices="restoreChoices" :preview="restorePreview" :scope="restoreScope" :disabled="busy" @restore="bench.restoreSelected" @recheck="bench.recheckRestore()" />
      <p v-else-if="job?.kind === 'restore-check' && !job.state.done" class="empty muted">正在比较备份和目标中的文件…</p>
      <div v-else class="empty">
        <Icon name="restore" :size="28" />
        <h2>{{ restoreForm.kind === 'task' ? '选择一个任务，查看它备份了哪些文件' : '选择备份文件夹和恢复目标' }}</h2>
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
