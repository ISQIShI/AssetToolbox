<script setup lang="ts">
import { computed } from 'vue';
import type { Definition, Step } from './types';
import { createStep } from './model';
import ParameterFields from './ParameterFields.vue';
const props = defineProps<{ definition: Definition; modelValue: Step; index: number; count: number; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: Step]; remove: []; move: [direction: number] }>();
const operation = computed(() => props.definition.operations.find(item => item.id === props.modelValue.operation));
const provider = computed(() => props.definition.providers.find(item => item.id === props.modelValue.provider));
const available = computed(() => props.definition.operations.filter(item => props.definition.providers.some(p => p.supports.some(s => s.resourceType === props.modelValue.resourceType && s.operation === item.id))));
const providers = computed(() => props.definition.providers.filter(p => p.supports.some(s => s.resourceType === props.modelValue.resourceType && s.operation === props.modelValue.operation)));
function change(resourceType: string, operationId?: string, providerId?: string) {
    const implementation = props.definition.providers.find(p => (!providerId || p.id === providerId) && p.supports.some(s => s.resourceType === resourceType && (!operationId || s.operation === operationId)));
    const support = implementation?.supports.find(s => s.resourceType === resourceType && (!operationId || s.operation === operationId));
    if (support) emit('update:modelValue', { ...createStep(props.definition, resourceType, support.operation, implementation!.id), id: props.modelValue.id, enabled: props.modelValue.enabled });
}
</script>
<template>
  <section class="module-card step-card" :class="{ inactive: !modelValue.enabled }" :data-step-id="modelValue.id" :aria-label="`步骤 ${index + 1}`">
    <header><h3>{{ index + 1 }}. {{ definition.resourceTypes.find(type => type.id === modelValue.resourceType)?.displayName }} · {{ operation?.displayName }}</h3><label class="switch"><input type="checkbox" :aria-label="`启用步骤 ${index + 1}`" :checked="modelValue.enabled" :disabled="disabled" @change="emit('update:modelValue', { ...modelValue, enabled: ($event.target as HTMLInputElement).checked })"><span></span></label></header>
    <div class="fields">
      <label class="field">资源类型<select aria-label="资源类型" :disabled="disabled" :value="modelValue.resourceType" @change="change(($event.target as HTMLSelectElement).value)"><option v-for="type in definition.resourceTypes" :key="type.id" :value="type.id">{{ type.displayName }}</option></select></label>
      <label class="field">处理操作<select aria-label="处理操作" :disabled="disabled" :value="modelValue.operation" @change="change(modelValue.resourceType, ($event.target as HTMLSelectElement).value)"><option v-for="item in available" :key="item.id" :value="item.id">{{ item.displayName }}</option></select></label>
      <label class="field">实现提供方<select aria-label="实现提供方" :disabled="disabled" :value="modelValue.provider" @change="change(modelValue.resourceType, modelValue.operation, ($event.target as HTMLSelectElement).value)"><option v-for="item in providers" :key="item.id" :value="item.id">{{ item.displayName }}</option></select></label>
    </div>
    <p class="module-description">{{ operation?.description }}</p>
    <ParameterFields :fields="operation?.fields || []" :model-value="modelValue.parameters" :disabled="disabled || !modelValue.enabled" @update:model-value="emit('update:modelValue', { ...modelValue, parameters: $event })" />
    <ParameterFields :fields="provider?.fields || []" :model-value="modelValue.providerOptions" :disabled="disabled || !modelValue.enabled" @update:model-value="emit('update:modelValue', { ...modelValue, providerOptions: $event })" />
    <div class="actions step-actions"><button :disabled="disabled || index === 0" aria-label="上移步骤" @click="emit('move', -1)">上移</button><button :disabled="disabled || index === count - 1" aria-label="下移步骤" @click="emit('move', 1)">下移</button><button :disabled="disabled" aria-label="删除步骤" @click="emit('remove')">删除</button></div>
  </section>
</template>
