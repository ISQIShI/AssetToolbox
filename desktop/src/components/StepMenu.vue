<script setup lang="ts">
// 处理线步骤的右键菜单：与步骤编辑器里的命令相同，只是不必先选中再去右侧找按钮。
// 行为（定位、键盘导航、点击别处关闭）由 Reka UI 的 ContextMenu 提供。
import { ContextMenuContent, ContextMenuItem, ContextMenuPortal, ContextMenuRoot, ContextMenuSeparator, ContextMenuTrigger } from 'reka-ui';
import Icon from './Icon.vue';

defineProps<{ index: number; count: number; enabled: boolean; disabled?: boolean }>();
const emit = defineEmits<{ select: []; move: [offset: number]; toggle: []; remove: [] }>();
</script>

<template>
  <ContextMenuRoot @update:open="$event && emit('select')">
    <ContextMenuTrigger as-child><slot /></ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent class="menu-popup" :aria-label="`第 ${index + 1} 步的命令`">
        <ContextMenuItem class="menu-item" :disabled="disabled || index === 0" @select="emit('move', -1)"><Icon name="up" :size="14" />上移<kbd>Alt+↑</kbd></ContextMenuItem>
        <ContextMenuItem class="menu-item" :disabled="disabled || index === count - 1" @select="emit('move', 1)"><Icon name="down" :size="14" />下移<kbd>Alt+↓</kbd></ContextMenuItem>
        <ContextMenuItem class="menu-item" :disabled="disabled" @select="emit('toggle')"><Icon name="power" :size="14" />{{ enabled ? '停用此步骤' : '启用此步骤' }}</ContextMenuItem>
        <ContextMenuSeparator class="menu-separator" />
        <ContextMenuItem class="menu-item danger" :disabled="disabled" @select="emit('remove')"><Icon name="trash" :size="14" />删除步骤…</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
