<script setup lang="ts">
// 界面图标：16px 网格上的单色线条，颜色跟随文字。全部自绘，不引入图标库。
// 图标只作辅助识别，含义必须同时由文字或 aria-label 表达。
const paths = {
    process: ['M4 5.2v5.6', 'M8 3.5h5.5', 'M8 8h5.5', 'M8 12.5h5.5'],
    tasks: ['M2.5 4l1.3 1.3L6 3', 'M8.5 4h5', 'M2.5 8.3l1.3 1.3L6 7.3', 'M8.5 8.3h5', 'M3 12.6h2.6', 'M8.5 12.6h5'],
    restore: ['M3.4 5.4A5.2 5.2 0 1 1 2.8 8', 'M3.2 2.4v3.2h3.2'],
    tools: ['M8 1.8l5.5 3v6.4L8 14.2l-5.5-3V4.8z', 'M2.5 4.8L8 8l5.5-3.2', 'M8 8v6.2'],
    theme: ['M8 2.5v11'],
    folder: ['M1.8 4.3c0-.6.4-1 1-1h3L7.2 4.8h6c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H2.8c-.6 0-1-.4-1-1z'],
    play: [],
    scan: ['M10.2 10.2l3.3 3.3'],
    save: ['M2.8 2.5h8l2.4 2.4v8.6H2.8z', 'M5.2 2.5v3.3h4.6V2.5', 'M5.2 13.5V9.6h5.6v3.9'],
    plus: ['M8 3v10', 'M3 8h10'],
    up: ['M8 13V3.2', 'M4 7l4-4 4 4'],
    down: ['M8 3v9.8', 'M4 9l4 4 4-4'],
    trash: ['M2.8 4.5h10.4', 'M6 4.5V2.8h4v1.7', 'M4.3 4.5l.6 8.7h6.2l.6-8.7'],
    refresh: ['M12.9 8.6a5 5 0 0 1-9 2.4', 'M3.1 7.4a5 5 0 0 1 9-2.4', 'M12.4 2.3V5H9.7', 'M3.6 13.7V11h2.7'],
    close: ['M4 4l8 8', 'M12 4l-8 8'],
    chevron: ['M6 3.5L10.5 8 6 12.5'],
    minimize: ['M3.5 8h9'],
    maximize: ['M3.5 3.5h9v9h-9z'],
    unmaximize: ['M3.5 5.5h7v7h-7z', 'M5.5 5.5v-2h7v7h-2'],
    ok: ['M5 8.3l2 2 4.2-4.6'],
    check: ['M3.4 8.5l3 3 6.2-6.8'],
    power: ['M8 2.4v5.2', 'M4.6 4.4a5 5 0 1 0 6.8 0'],
    alert: ['M8 4.6v4', 'M8 10.9v.3'],
    external: ['M9.2 2.8h4v4', 'M13 3L7.6 8.4', 'M11.2 9.4v3.8H2.8V4.8h3.8'],
    download: ['M8 2.5v8', 'M4.5 7.2L8 10.7l3.5-3.5', 'M3 13.5h10'],
    info: ['M8 7.4v3.6', 'M8 4.9v.2'],
    jobs: ['M1.8 8.4h2.7l1.7-4.6 3.1 8.6 1.8-4h3.1'],
    report: ['M3.5 2h6l3 3v9h-9z', 'M9.5 2v3h3', 'M5.8 8.2h4.4', 'M5.8 11h4.4'],
} as const;
export type IconName = keyof typeof paths;
defineProps<{ name: IconName; size?: number }>();
</script>

<template>
  <svg class="icon" :width="size || 16" :height="size || 16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path v-for="d in paths[name]" :key="d" :d="d" />
    <template v-if="name === 'process'"><circle cx="4" cy="3.5" r="1.7" /><circle cx="4" cy="12.5" r="1.7" /></template>
    <template v-else-if="name === 'theme'"><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none" /></template>
    <path v-else-if="name === 'play'" d="M5 3.3v9.4a.4.4 0 0 0 .6.3l7.3-4.7a.4.4 0 0 0 0-.6L5.6 3a.4.4 0 0 0-.6.3z" fill="currentColor" stroke="none" />
    <circle v-else-if="name === 'scan'" cx="7" cy="7" r="4.3" />
    <circle v-else-if="name === 'ok' || name === 'alert' || name === 'info'" cx="8" cy="8" r="5.7" />
  </svg>
</template>

<style scoped>
.icon { flex: none; display: block; }
</style>
