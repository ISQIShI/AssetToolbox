<script setup lang="ts">
// 活动页：把“任务”（按文件夹保存的处理进度，可继续、可恢复）和“作业队列”（正在运行、排队和历史作业）
// 放在同一个工作区里，用顶部的分段选择切换。两个子视图各自保持原有的状态与轮询。
import { useWorkbench } from '../core/workbench';
import TasksView from './TasksView.vue';
import JobsView from './JobsView.vue';

const bench = useWorkbench();
const { page, tasks } = bench;
function show(target: 'tasks' | 'jobs') {
    page.value = target;
    if (target === 'tasks') bench.refreshTasks().catch(bench.fail);
}
</script>

<template>
  <div class="activity-view">
    <header class="switch">
      <fieldset class="segmented">
        <legend class="visually-hidden">活动视图</legend>
        <label :class="{ chosen: page === 'tasks' }"><input type="radio" class="visually-hidden" name="activity-view" :checked="page === 'tasks'" @change="show('tasks')">任务<span v-if="tasks.length" class="count">{{ tasks.length }}</span></label>
        <label :class="{ chosen: page === 'jobs' }"><input type="radio" class="visually-hidden" name="activity-view" :checked="page === 'jobs'" @change="show('jobs')">作业队列</label>
      </fieldset>
      <p class="muted small">{{ page === 'tasks' ? '每个来源文件夹的处理进度：可以继续未完成的文件，或检查备份并恢复。' : '正在运行和排队的作业，以及各入口提交过的作业记录。' }}</p>
    </header>
    <TasksView v-if="page === 'tasks'" class="pane" />
    <JobsView v-else class="pane" />
  </div>
</template>

<style scoped>
.activity-view { display: flex; flex-direction: column; min-height: 0; }
.switch { flex: none; display: flex; align-items: center; gap: var(--s-4); min-height: var(--command-height); padding: 0 var(--s-4); border-bottom: 1px solid var(--border-soft); background: var(--pane); }
.switch p { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.count { color: var(--text-3); font-weight: 400; font-size: var(--t-small); }
.pane { flex: 1; min-height: 0; animation: rise 0.16s ease-out; }
</style>
