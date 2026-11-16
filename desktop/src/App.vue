<script setup lang="ts">
// 窗口外壳：标题栏 / 活动栏 + 工作区 / 状态栏。工作区内自上而下是信息条、当前页面、作业栏。
import { computed, onMounted, onUnmounted, provide, watch } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createWorkbench, workbenchKey, type Page } from './core/workbench';
import { folderName } from './core/model';
import { themeLabel, toggleTheme } from './core/theme';
import ProcessView from './views/ProcessView.vue';
import ActivityView from './views/ActivityView.vue';
import RestoreView from './views/RestoreView.vue';
import ToolsView from './views/ToolsView.vue';
import JobDock from './components/JobDock.vue';
import TitleBar from './components/TitleBar.vue';
import Tip from './components/Tip.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import Icon, { type IconName } from './components/Icon.vue';

const bench = createWorkbench();
provide(workbenchKey, bench);
const { page, boot, config, tasks, loading, error, notice, job, busy, maintenanceBusy, closing, definition, missingProviders } = bench;

// 活动栏的一项可以包含多个页面：“活动”下有任务与作业队列两个视图，由 ActivityView 内的分段选择切换。
interface Tab { id: string; label: string; icon: IconName; pages: Page[]; missing?: number }
const tabs = computed<Tab[]>(() => [
    { id: 'process', label: '处理', icon: 'process', pages: ['process'] },
    { id: 'activity', label: '活动', icon: 'jobs', pages: ['tasks', 'jobs'] },
    { id: 'restore', label: '恢复', icon: 'restore', pages: ['restore'] },
    { id: 'tools', label: '工具', icon: 'tools', pages: ['tools'], missing: missingProviders.value.length },
]);
// 再次进入“活动”时回到上次看的视图。
let lastActivity: Page = 'tasks';
watch(page, value => { if (value === 'tasks' || value === 'jobs') lastActivity = value; });
const open = (tab: Tab) => go(tab.pages.includes(lastActivity) ? lastActivity : tab.pages[0]!);
const context = computed(() => config.value?.sourceDir.trim() ? folderName(config.value.sourceDir) : '');
const resumable = computed(() => tasks.value.filter(task => task.canResume).length);
const providerCount = computed(() => definition.value?.providers.length || 0);
const activity = computed(() => {
    if (loading.value) return '正在读取配置和处理工具';
    if (closing.value) return '正在安全退出';
    if (maintenanceBusy.value) return '正在维护存储';
    if (busy.value) return job.value ? `正在运行：${job.value.title}` : '正在启动作业';
    return '就绪';
});

function go(target: Page) {
    page.value = target;
    if (target === 'tasks') bench.refreshTasks().catch(bench.fail);
}

// 快捷键：Ctrl+1–4 切换工作区，Ctrl+S 保存处理配置。
function shortcut(event: KeyboardEvent) {
    if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    const index = ['1', '2', '3', '4'].indexOf(event.key);
    if (index >= 0) { event.preventDefault(); open(tabs.value[index]!); return; }
    if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (page.value === 'process' && !busy.value) void bench.saveConfig();
    }
}

let unlisten: (() => void) | undefined;
onMounted(async () => {
    window.addEventListener('keydown', shortcut);
    await bench.initialize();
    try {
        unlisten = await getCurrentWindow().onCloseRequested(async event => {
            if (!(await bench.requestClose())) event.preventDefault();
        });
    } catch { /* 浏览器样式调试与组件测试中没有原生窗口。 */ }
});
onUnmounted(() => { window.removeEventListener('keydown', shortcut); bench.stop(); unlisten?.(); });
</script>

<template>
  <div class="shell">
    <TitleBar :context="context" />

    <div class="body">
      <aside class="activity">
        <nav class="tabs" aria-label="工作区">
          <Tip v-for="(tab, index) in tabs" :key="tab.id" :text="tab.label" :shortcut="`Ctrl+${index + 1}`" side="right">
            <button type="button" class="tab" :aria-current="tab.pages.includes(page) ? 'page' : undefined" @click="open(tab)">
              <Icon :name="tab.icon" :size="18" />
              <span>{{ tab.label }}</span>
              <span v-if="tab.missing" class="tab-missing">{{ tab.missing }}<span class="visually-hidden"> 个缺少依赖</span></span>
            </button>
          </Tip>
        </nav>
        <Tip :text="`外观：${themeLabel}`" side="right"><button type="button" class="tab theme" :aria-label="`外观：${themeLabel}`" @click="toggleTheme"><Icon name="theme" :size="18" /></button></Tip>
      </aside>

      <div class="workspace">
        <div v-if="error || notice || boot?.warnings?.length" class="messages">
          <div v-if="error" role="alert" class="callout danger"><Icon name="alert" class="tone danger" /><p class="selectable">{{ error }}</p><Tip text="关闭"><button type="button" class="button quiet small icon-only" aria-label="关闭错误" @click="error = ''"><Icon name="close" :size="14" /></button></Tip></div>
          <div v-if="notice" role="status" class="callout ok"><Icon name="ok" class="tone ok" /><p>{{ notice }}</p><Tip text="关闭"><button type="button" class="button quiet small icon-only" aria-label="关闭提示" @click="notice = ''"><Icon name="close" :size="14" /></button></Tip></div>
          <div v-for="warning in boot?.warnings" :key="warning" class="callout warn"><Icon name="alert" class="tone warn" /><p>{{ warning }}</p></div>
        </div>

        <main class="stage">
          <p v-if="loading" class="loading">正在读取配置和处理工具…</p>
          <ProcessView v-else-if="page === 'process'" />
          <ActivityView v-else-if="page === 'tasks' || page === 'jobs'" />
          <RestoreView v-else-if="page === 'restore'" />
          <ToolsView v-else />
        </main>

        <!-- 处理页把作业放在右侧概览栏里，其他页面停靠在底部 -->
        <JobDock v-if="job && !(page === 'process' && config && definition && !loading)" />
        <ConfirmDialog />
      </div>
    </div>

    <footer class="statusbar">
      <p class="status-item"><span class="pulse" :class="{ busy: busy || loading }" aria-hidden="true"></span>{{ activity }}</p>
      <span class="spacer"></span>
      <button v-if="resumable" type="button" class="status-item link" @click="go('tasks')">{{ resumable }} 个任务可继续</button>
      <button v-if="providerCount" type="button" class="status-item link" :class="{ 'tone missing': missingProviders.length }" @click="go('tools')">
        <span v-if="missingProviders.length" class="missing-swatch" aria-hidden="true"></span>
        处理工具 {{ providerCount - missingProviders.length }} / {{ providerCount }} 可用
      </button>
    </footer>
  </div>
</template>

<style scoped>
.shell { display: flex; flex-direction: column; height: 100vh; min-width: 0; background: var(--chrome); }
.body { flex: 1; min-height: 0; display: flex; }

/* 活动栏：工作区切换。选中项左侧有一段强调色标记 */
.activity { flex: none; width: var(--activity-width); display: flex; flex-direction: column; justify-content: space-between; padding: var(--s-1) 0 var(--s-2); }
.tabs { display: grid; gap: 2px; }
.tab {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 2px;
  margin: 0 6px;
  padding: 7px 0 5px;
  border: 0;
  border-radius: var(--r-panel);
  background: none;
  color: var(--text-2);
  font-size: var(--t-small);
}
.tab:hover { background: var(--hover); color: var(--text); }
.tab[aria-current='page'] { background: var(--pressed); color: var(--text); }
.tab[aria-current='page']::before { content: ''; position: absolute; left: -3px; top: 14px; bottom: 14px; width: 3px; border-radius: 2px; background: var(--accent); }
.tab[aria-current='page'] .icon { color: var(--accent); }
.tab-missing { position: absolute; top: 2px; right: 3px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--missing); color: var(--on-missing); font-size: 11px; line-height: 16px; text-align: center; }
.tab.theme { padding: 8px 0; }

/* 工作区：从窗口框架上“抬起”的一块，左上角为圆角 */
.workspace { flex: 1; min-width: 0; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border-soft); border-right: 0; border-bottom: 0; border-top-left-radius: var(--r-float); overflow: hidden; }
.messages { flex: none; display: grid; gap: var(--s-1); padding: var(--s-2) var(--s-3); background: var(--pane); border-bottom: 1px solid var(--border-soft); max-height: 30vh; overflow-y: auto; }
.stage { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
/* 页面切换：新页面短促淡入。旧页面立即移除，不做离场动画，避免两个页面的作业栏同时存在 */
.stage > :deep(*) { flex: 1; min-height: 0; animation: page-in 0.12s ease-out; }
@keyframes page-in { from { opacity: 0; } }
.loading { padding: var(--s-6); color: var(--text-2); }

.statusbar { flex: none; display: flex; align-items: center; gap: var(--s-1); height: var(--status-height); padding: 0 var(--s-2); border-top: 1px solid var(--border-soft); color: var(--text-2); font-size: var(--t-small); }
.status-item { display: inline-flex; align-items: center; gap: 6px; height: 100%; padding: 0 var(--s-2); border: 0; background: none; color: inherit; font-size: inherit; white-space: nowrap; }
.status-item.link:hover { background: var(--hover); color: var(--text); }
.status-item.missing { color: var(--missing); }
.spacer { flex: 1; }
.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
.pulse.busy { background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.35; } }
</style>
