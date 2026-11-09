<script setup lang="ts">
import { computed, onMounted, onUnmounted, provide } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createWorkbench, workbenchKey, type Page } from './core/workbench';
import ProcessView from './views/ProcessView.vue';
import TasksView from './views/TasksView.vue';
import RestoreView from './views/RestoreView.vue';
import ToolsView from './views/ToolsView.vue';
import JobDock from './components/JobDock.vue';

const bench = createWorkbench();
provide(workbenchKey, bench);
const { page, boot, tasks, loading, error, notice, job, missingProviders } = bench;

const tabs = computed<{ id: Page; label: string; count?: number; missing?: number }[]>(() => [
    { id: 'process', label: '处理' },
    { id: 'tasks', label: '任务', count: tasks.value.length },
    { id: 'restore', label: '恢复' },
    { id: 'tools', label: '工具', missing: missingProviders.value.length },
]);

function go(target: Page) {
    page.value = target;
    if (target === 'tasks') bench.refreshTasks().catch(bench.fail);
}

let unlisten: (() => void) | undefined;
onMounted(async () => {
    await bench.initialize();
    try {
        unlisten = await getCurrentWindow().onCloseRequested(async event => {
            if (!(await bench.requestClose())) event.preventDefault();
        });
    } catch { /* 浏览器样式调试与组件测试中没有原生窗口。 */ }
});
onUnmounted(() => { bench.stop(); unlisten?.(); });
</script>

<template>
  <div class="shell" :class="{ 'has-dock': job }">
    <header class="bar">
      <p class="wordmark">资源工具箱</p>
      <nav class="tabs" aria-label="工作区">
        <button v-for="tab in tabs" :key="tab.id" type="button" class="tab" :aria-current="page === tab.id ? 'page' : undefined" @click="go(tab.id)">
          {{ tab.label }}
          <span v-if="tab.count" class="tab-count">{{ tab.count }}</span>
          <span v-if="tab.missing" class="tab-missing" :title="`${tab.missing} 个处理工具缺少依赖`"><span class="missing-swatch" aria-hidden="true"></span>{{ tab.missing }}<span class="visually-hidden"> 个缺少依赖</span></span>
        </button>
      </nav>
    </header>

    <div v-if="error || notice || boot?.warnings?.length" class="messages">
      <div v-if="error" role="alert" class="callout danger"><p>{{ error }}</p><button type="button" class="button quiet small" aria-label="关闭错误" @click="error = ''">关闭</button></div>
      <div v-if="notice" role="status" class="callout ok"><p>{{ notice }}</p><button type="button" class="button quiet small" aria-label="关闭提示" @click="notice = ''">关闭</button></div>
      <div v-for="warning in boot?.warnings" :key="warning" class="callout warn"><p>{{ warning }}</p></div>
    </div>

    <main class="stage">
      <p v-if="loading" class="loading">正在读取配置和处理工具…</p>
      <ProcessView v-else-if="page === 'process'" />
      <TasksView v-else-if="page === 'tasks'" />
      <RestoreView v-else-if="page === 'restore'" />
      <ToolsView v-else />
    </main>

    <JobDock v-if="job" />
  </div>
</template>

<style scoped>
/* 纵向：顶栏 / 提示 / 工作区（占满剩余高度）/ 作业栏。提示和作业栏按需出现。 */
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-width: 0;
}
.bar {
  flex: none;
  height: var(--bar-height);
  display: flex;
  align-items: stretch;
  gap: var(--s-6);
  padding: 0 var(--s-5);
  background: var(--canvas);
  border-bottom: 1px solid var(--rule);
}
.wordmark {
  align-self: center;
  font-size: var(--t-lead);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.tabs { display: flex; gap: var(--s-1); }
.tab {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  padding: 0 var(--s-4);
  border: 0;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  background: none;
  color: var(--ink-2);
  font-weight: 500;
  cursor: pointer;
}
.tab:hover { color: var(--ink); }
.tab[aria-current='page'] { color: var(--ink); border-bottom-color: var(--ink); }
.tab-count { color: var(--ink-2); font-size: var(--t-small); }
.tab-missing { display: inline-flex; align-items: center; gap: var(--s-1); color: var(--missing); font-size: var(--t-small); }
.messages { display: grid; gap: 1px; background: var(--rule); border-bottom: 1px solid var(--rule); }
.messages .callout { align-items: center; }
.messages { flex: none; }
.stage { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.stage > :deep(*) { flex: 1; min-height: 0; }
.loading { padding: var(--s-6); color: var(--ink-2); }
</style>
