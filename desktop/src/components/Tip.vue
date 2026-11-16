<script setup lang="ts">
// 提示：悬停或键盘聚焦到控件时显示的一行说明，可附带快捷键。行为由 Reka UI 提供。
// 包裹的必须是单个可聚焦元素；提示只是补充，控件自身仍要有文字或 aria-label。
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui';
defineProps<{ text: string; shortcut?: string; side?: 'top' | 'right' | 'bottom' | 'left' }>();
</script>

<template>
  <TooltipProvider :delay-duration="450" :skip-delay-duration="150" disable-hoverable-content>
    <TooltipRoot>
      <TooltipTrigger as-child><slot /></TooltipTrigger>
      <TooltipPortal>
        <TooltipContent class="tooltip" :side="side || 'bottom'" :side-offset="6" :collision-padding="8">
          {{ text }}<kbd v-if="shortcut">{{ shortcut }}</kbd>
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>
