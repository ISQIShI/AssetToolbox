<script setup lang="ts">
// 自绘标题栏：原生窗口去掉系统边框后，由这里提供拖动区域和最小化、最大化、关闭按钮。
// 浏览器调试与组件测试中没有原生窗口，只显示标题，不显示窗口按钮。
import { onMounted, onUnmounted, ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import Icon from './Icon.vue';

defineProps<{ context?: string }>();
const native = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const maximized = ref(false);
let unlisten: (() => void) | undefined;

async function sync() { try { maximized.value = await getCurrentWindow().isMaximized(); } catch { /* 窗口正在关闭。 */ } }
onMounted(async () => {
    if (!native) return;
    await sync();
    try { unlisten = await getCurrentWindow().onResized(sync); } catch { /* 忽略：只影响最大化图标。 */ }
});
onUnmounted(() => unlisten?.());

const minimize = () => getCurrentWindow().minimize().catch(() => {});
const toggle = () => getCurrentWindow().toggleMaximize().then(sync).catch(() => {});
// close() 会触发 onCloseRequested，有作业时由工作台先协作取消再退出。
const close = () => getCurrentWindow().close().catch(() => {});
</script>

<template>
  <header class="titlebar" data-tauri-drag-region>
    <svg class="app-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" data-tauri-drag-region>
      <rect width="16" height="16" rx="3.5" fill="var(--brand)" />
      <path d="M5 5l5.8 5.8M11 6.4V11H6.4" fill="none" stroke="var(--on-solid)" stroke-width="1.5" />
    </svg>
    <h1 class="app-name" data-tauri-drag-region>资源工具箱</h1>
    <p v-if="context" class="context" data-tauri-drag-region>{{ context }}</p>
    <div v-if="native" class="window-controls">
      <button type="button" class="window-button" aria-label="最小化" tabindex="-1" @click="minimize"><Icon name="minimize" /></button>
      <button type="button" class="window-button" :aria-label="maximized ? '向下还原' : '最大化'" tabindex="-1" @click="toggle"><Icon :name="maximized ? 'unmaximize' : 'maximize'" /></button>
      <button type="button" class="window-button close" aria-label="关闭窗口" tabindex="-1" @click="close"><Icon name="close" /></button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  flex: none;
  display: flex;
  align-items: center;
  height: var(--titlebar-height);
  padding-left: var(--s-3);
  background: var(--chrome);
}
.app-icon { flex: none; margin-right: var(--s-2); }
.app-name { flex: none; font-size: var(--t-small); font-weight: 400; }
/* 当前来源文件夹：跟在应用名后面，用一条短竖线隔开 */
.context { flex: 0 1 auto; min-width: 0; margin: 0 var(--s-4) 0 var(--s-3); padding-left: var(--s-3); border-left: 1px solid var(--border); color: var(--text-2); font-size: var(--t-small); line-height: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.window-controls { display: flex; align-self: stretch; margin-left: auto; }
.window-button { display: grid; place-items: center; width: 46px; border: 0; background: none; color: var(--text); }
.window-button:hover { background: var(--hover); }
.window-button:active { background: var(--pressed); }
.window-button.close:hover { background: var(--danger-solid); color: var(--on-solid); }
</style>
