<script setup lang="ts">
import type { Field, Value } from './types';
const props = defineProps<{ fields: Field[]; modelValue: Record<string, Value>; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, Value>] }>();
function update(key: string, value: Value) { emit('update:modelValue', { ...props.modelValue, [key]: value }); }
</script>
<template>
  <div class="fields">
    <label v-for="field in fields" :key="field.key" class="field" :class="{ boolean: field.type === 'boolean' }">
      <span>{{ field.label }}</span>
      <input v-if="field.type === 'boolean'" type="checkbox" :checked="Boolean(modelValue[field.key])" :aria-label="field.label" :disabled="disabled" @change="update(field.key, ($event.target as HTMLInputElement).checked)">
      <select v-else-if="field.type === 'enum'" :value="String(modelValue[field.key])" :aria-label="field.label" :disabled="disabled" @change="update(field.key, ($event.target as HTMLSelectElement).value)"><option v-for="choice in field.choices" :key="String(choice.value)" :value="String(choice.value)">{{ choice.label }}</option></select>
      <input v-else-if="field.type === 'integer' || field.type === 'number'" type="number" :value="modelValue[field.key]" :min="field.min" :max="field.max" :step="field.step || 1" :aria-label="field.label" :disabled="disabled" @input="update(field.key, ($event.target as HTMLInputElement).value === '' ? '' : Number(($event.target as HTMLInputElement).value))">
      <input v-else type="text" :value="modelValue[field.key]" :maxlength="field.maxLength" :aria-label="field.label" :disabled="disabled" @input="update(field.key, ($event.target as HTMLInputElement).value)">
      <small v-if="field.hint">{{ field.hint }}</small><small v-else-if="field.min !== undefined">范围 {{ field.min }} – {{ field.max }}</small>
    </label>
  </div>
</template>
