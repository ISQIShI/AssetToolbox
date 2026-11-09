<script setup lang="ts">
// 按核心返回的字段描述渲染参数；前端不内置任何工具的参数表。
import type { Field, Value } from '../core/types';
const props = defineProps<{ fields: Field[]; modelValue: Record<string, Value>; disabled?: boolean; idPrefix: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, Value>] }>();
function update(key: string, value: Value) { emit('update:modelValue', { ...props.modelValue, [key]: value }); }
function numeric(event: Event): Value { const raw = (event.target as HTMLInputElement).value; return raw === '' ? '' : Number(raw); }
function hint(field: Field) {
    const range = field.min !== undefined && field.max !== undefined ? `范围 ${field.min}–${field.max}` : '';
    return [range, field.hint].filter(Boolean).join('。');
}
</script>

<template>
  <div class="parameters">
    <template v-for="field in fields" :key="field.key">
      <div v-if="field.type === 'boolean'" class="field wide">
        <label class="check"><input type="checkbox" :checked="Boolean(modelValue[field.key])" :disabled="disabled" @change="update(field.key, ($event.target as HTMLInputElement).checked)">{{ field.label }}</label>
        <p v-if="field.hint" class="hint">{{ field.hint }}</p>
      </div>
      <div v-else class="field" :class="{ wide: field.type === 'text' }">
        <label class="label" :for="`${idPrefix}-${field.key}`">{{ field.label }}</label>
        <select v-if="field.type === 'enum'" :id="`${idPrefix}-${field.key}`" class="select" :value="String(modelValue[field.key])" :disabled="disabled" @change="update(field.key, ($event.target as HTMLSelectElement).value)">
          <option v-for="choice in field.choices" :key="String(choice.value)" :value="String(choice.value)">{{ choice.label }}</option>
        </select>
        <input v-else-if="field.type === 'integer' || field.type === 'number'" :id="`${idPrefix}-${field.key}`" class="input" type="number" inputmode="decimal" :value="modelValue[field.key]" :min="field.min" :max="field.max" :step="field.step || 1" :disabled="disabled" @input="update(field.key, numeric($event))">
        <input v-else :id="`${idPrefix}-${field.key}`" class="input" type="text" :value="modelValue[field.key]" :maxlength="field.maxLength" :disabled="disabled" @input="update(field.key, ($event.target as HTMLInputElement).value)">
        <p v-if="hint(field)" class="hint">{{ hint(field) }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.parameters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--s-4) var(--s-5);
}
.wide { grid-column: 1 / -1; }
.check { font-weight: 500; }
</style>
