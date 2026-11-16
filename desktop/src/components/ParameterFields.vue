<script setup lang="ts">
// 按核心返回的字段描述渲染参数；前端不内置任何工具的参数表。
// 每个字段是属性表单的一行：标签在左，控件在右，提示在控件下方。
import type { Field, Value } from '../core/types';
import SelectBox from './SelectBox.vue';
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
      <div v-if="field.type === 'boolean'" class="field">
        <label class="check option"><input type="checkbox" :checked="Boolean(modelValue[field.key])" :disabled="disabled" @change="update(field.key, ($event.target as HTMLInputElement).checked)">{{ field.label }}</label>
        <p v-if="field.hint" class="hint">{{ field.hint }}</p>
      </div>
      <div v-else class="field">
        <label class="label" :for="`${idPrefix}-${field.key}`">{{ field.label }}</label>
        <SelectBox v-if="field.type === 'enum'" :id="`${idPrefix}-${field.key}`" class="choice" :model-value="String(modelValue[field.key])" :options="(field.choices || []).map(choice => ({ value: String(choice.value), label: choice.label }))" :disabled="disabled" @update:model-value="update(field.key, $event)" />
        <input v-else-if="field.type === 'integer' || field.type === 'number'" :id="`${idPrefix}-${field.key}`" class="input number" type="number" inputmode="decimal" :value="modelValue[field.key]" :min="field.min" :max="field.max" :step="field.step || 1" :disabled="disabled" @input="update(field.key, numeric($event))">
        <input v-else :id="`${idPrefix}-${field.key}`" class="input" type="text" :value="modelValue[field.key]" :maxlength="field.maxLength" :disabled="disabled" @input="update(field.key, ($event.target as HTMLInputElement).value)">
        <p v-if="hint(field)" class="hint">{{ hint(field) }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.parameters { display: grid; gap: var(--s-2); }
.number { max-width: 140px; }
.option { min-height: var(--control-height); }
@container editor (max-width: 420px) {
  .field { grid-template-columns: minmax(0, 1fr); }
  .field > :not(.label) { grid-column: 1; }
  .field > .label { min-height: 0; }
}
</style>
