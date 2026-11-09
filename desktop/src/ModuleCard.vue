<script setup lang="ts">
import type { Configuration, Module, Value } from './types';
const props = defineProps<{ module: Module; modelValue: Configuration; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: Configuration] }>();
function update(key: string, value: Value) { emit('update:modelValue', { ...props.modelValue, [key]: value }); }
</script>
<template>
  <section class="module-card" :class="{ inactive: !modelValue[module.enabledKey] }">
    <header><div><h3>{{ module.displayName }}</h3><span class="extensions">{{ module.extensions.join(' · ') }}</span></div>
      <label class="switch"><input type="checkbox" :aria-label="`启用 ${module.displayName}`" :checked="Boolean(modelValue[module.enabledKey])" :disabled="disabled" @change="update(module.enabledKey, ($event.target as HTMLInputElement).checked)"><span></span></label>
    </header>
    <p v-if="module.description" class="module-description">{{ module.description }}</p>
    <div class="fields">
      <label v-for="field in module.fields.filter(field => !field.isEnable)" :key="field.key" class="field" :class="{ boolean: field.type === 'boolean' }">
        <span>{{ field.label }}</span>
        <input v-if="field.type === 'boolean'" type="checkbox" :checked="Boolean(modelValue[field.key])" :aria-label="field.label" :disabled="disabled || !modelValue[module.enabledKey]" @change="update(field.key, ($event.target as HTMLInputElement).checked)">
        <select v-else-if="field.type === 'enum'" :value="String(modelValue[field.key])" :aria-label="field.label" :disabled="disabled || !modelValue[module.enabledKey]" @change="update(field.key, field.choices!.find(choice => String(choice.value) === ($event.target as HTMLSelectElement).value)!.value)"><option v-for="choice in field.choices" :key="String(choice.value)" :value="String(choice.value)">{{ choice.label }}</option></select>
        <input v-else-if="field.type === 'integer' || field.type === 'number'" type="number" :value="modelValue[field.key]" :min="field.min" :max="field.max" :step="field.step || (field.type === 'integer' ? 1 : 'any')" :aria-label="field.label" :disabled="disabled || !modelValue[module.enabledKey]" @input="update(field.key, ($event.target as HTMLInputElement).value === '' ? '' : Number(($event.target as HTMLInputElement).value))">
        <input v-else type="text" :value="modelValue[field.key]" :maxlength="field.maxLength" :aria-label="field.label" :disabled="disabled || !modelValue[module.enabledKey]" @input="update(field.key, ($event.target as HTMLInputElement).value)">
        <small v-if="field.hint">{{ field.hint }}</small><small v-else-if="field.min !== undefined">范围 {{ field.min }} – {{ field.max }}</small>
      </label>
    </div>
  </section>
</template>
