<script setup lang="ts">
// 文件夹路径：可粘贴，也可通过原生对话框选择。路径以等宽字体显示，方便核对。
import { useId } from 'vue';
import { useWorkbench } from '../core/workbench';
import Icon from './Icon.vue';
const props = defineProps<{ label: string; modelValue: string; disabled?: boolean; dialogTitle?: string; hint?: string; placeholder?: string; stacked?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const bench = useWorkbench();
const id = useId();
async function browse() {
    const value = await bench.browse(props.dialogTitle || props.label, props.modelValue);
    if (value) emit('update:modelValue', value);
}
</script>

<template>
  <div class="field" :class="{ stacked }">
    <label class="label" :for="id">{{ label }}</label>
    <div class="path-row">
      <input :id="id" class="input path" :value="modelValue" :disabled="disabled" :placeholder="placeholder || '粘贴路径或点击浏览'" spellcheck="false" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)">
      <button type="button" class="button" :disabled="disabled" :aria-label="`选择${label}`" @click="browse"><Icon name="folder" />浏览…</button>
    </div>
    <p v-if="hint" class="hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.path-row { display: flex; gap: var(--s-1); min-width: 0; }
</style>
