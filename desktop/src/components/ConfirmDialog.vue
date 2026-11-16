<script setup lang="ts">
// 确认对话框：用于无法撤销的操作。状态在工作台（bench.confirmation），同一时间最多一个。
// 焦点陷阱、Esc 取消和 ARIA 由 Reka UI 的 AlertDialog 提供；默认焦点在“取消”上。
// 取消（按钮或 Esc）经 update:open 统一处理；确认按钮是普通按钮，先回答再关闭，避免被关闭事件抢先判为取消。
import { AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogRoot, AlertDialogTitle } from 'reka-ui';
import { useWorkbench } from '../core/workbench';

const bench = useWorkbench();
const { confirmation } = bench;
</script>

<template>
  <AlertDialogRoot :open="Boolean(confirmation)" @update:open="!$event && bench.answerConfirmation(false)">
    <AlertDialogPortal>
      <AlertDialogOverlay class="dialog-overlay" />
      <AlertDialogContent v-if="confirmation" class="dialog">
        <AlertDialogTitle as="h2">{{ confirmation.title }}</AlertDialogTitle>
        <AlertDialogDescription as="p">{{ confirmation.message }}</AlertDialogDescription>
        <div class="dialog-actions">
          <AlertDialogCancel class="button">取消</AlertDialogCancel>
          <button type="button" class="button" :class="confirmation.danger ? 'danger-solid' : 'primary'" data-confirm @click="bench.answerConfirmation(true)">{{ confirmation.confirmLabel }}</button>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
