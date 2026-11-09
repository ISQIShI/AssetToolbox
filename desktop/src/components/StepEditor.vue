<script setup lang="ts">
// 单个步骤的编辑器：组合（资源类型 / 操作 / 处理工具）、启用、两组参数、顺序与删除。
import { computed, useId } from 'vue';
import type { Definition, Step } from '../core/types';
import { isMissing, resetStep, retargetStep, stepTitle } from '../core/model';
import ParameterFields from './ParameterFields.vue';

const props = defineProps<{ definition: Definition; modelValue: Step; index: number; count: number; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: Step]; remove: []; move: [offset: number]; 'show-tools': [] }>();
const id = useId();

const step = computed(() => props.modelValue);
const operation = computed(() => props.definition.operations.find(item => item.id === step.value.operation));
const provider = computed(() => props.definition.providers.find(item => item.id === step.value.provider));
const supported = (resourceType: string, operationId: string) => props.definition.providers.some(p => p.supports.some(s => s.resourceType === resourceType && s.operation === operationId));
const operations = computed(() => props.definition.operations.filter(item => supported(step.value.resourceType, item.id)));
const providers = computed(() => props.definition.providers.filter(p => p.supports.some(s => s.resourceType === step.value.resourceType && s.operation === step.value.operation)));
// 操作描述由扩展提供；缺省时按验收策略补一句说明。
const about = computed(() => operation.value?.description || (operation.value?.resultPolicy === 'smaller-only' ? '仅当结果比原文件小时采用，否则保留原文件。' : '输出有效即采用，结果可能比原文件大。'));
const locked = computed(() => props.disabled || !step.value.enabled);

function patch(value: Partial<Step>) { emit('update:modelValue', { ...step.value, ...value }); }
function retarget(resourceType: string, operationId?: string, providerId?: string) {
    const next = retargetStep(props.definition, step.value, resourceType, operationId, providerId);
    if (next) emit('update:modelValue', next);
}
</script>

<template>
  <article class="editor" :aria-label="`第 ${index + 1} 步`">
    <header class="head">
      <div class="heading">
        <p class="order">第 {{ index + 1 }} 步，共 {{ count }} 步</p>
        <h2>{{ stepTitle(definition, step) }}</h2>
      </div>
      <label class="check switch">
        <input type="checkbox" :checked="step.enabled" :disabled="disabled" @change="patch({ enabled: ($event.target as HTMLInputElement).checked })">
        启用此步骤
      </label>
    </header>

    <div v-if="isMissing(provider)" class="callout missing" role="status">
      <span class="missing-swatch" aria-hidden="true"></span>
      <p><strong>{{ provider?.displayName }} 缺少依赖。</strong>{{ provider?.availability?.reason }}。安装后在“工具”页刷新，或停用此步骤。</p>
      <button type="button" class="button small" @click="emit('show-tools')">查看获取方式</button>
    </div>

    <section class="combo" aria-label="步骤组合">
      <div class="field">
        <label class="label" :for="`${id}-type`">资源类型</label>
        <select :id="`${id}-type`" class="select" :value="step.resourceType" :disabled="disabled" @change="retarget(($event.target as HTMLSelectElement).value)">
          <option v-for="type in definition.resourceTypes" :key="type.id" :value="type.id">{{ type.displayName }}</option>
        </select>
      </div>
      <div class="field">
        <label class="label" :for="`${id}-operation`">操作</label>
        <select :id="`${id}-operation`" class="select" :value="step.operation" :disabled="disabled" @change="retarget(step.resourceType, ($event.target as HTMLSelectElement).value)">
          <option v-for="item in operations" :key="item.id" :value="item.id">{{ item.displayName }}</option>
        </select>
      </div>
      <div class="field">
        <label class="label" :for="`${id}-provider`">处理工具</label>
        <select :id="`${id}-provider`" class="select" :value="step.provider" :disabled="disabled" @change="retarget(step.resourceType, step.operation, ($event.target as HTMLSelectElement).value)">
          <option v-for="item in providers" :key="item.id" :value="item.id">{{ item.displayName }}{{ isMissing(item) ? '（缺少依赖）' : '' }}</option>
        </select>
      </div>
    </section>

    <p class="about">{{ about }}</p>

    <section v-if="operation?.fields.length" class="group">
      <h3>{{ operation.displayName }}参数</h3>
      <ParameterFields :id-prefix="`${id}-op`" :fields="operation.fields" :model-value="step.parameters" :disabled="locked" @update:model-value="patch({ parameters: $event })" />
    </section>
    <section v-if="provider?.fields.length" class="group">
      <h3>{{ provider.displayName }} 参数</h3>
      <ParameterFields :id-prefix="`${id}-tool`" :fields="provider.fields" :model-value="step.providerOptions" :disabled="locked" @update:model-value="patch({ providerOptions: $event })" />
    </section>
    <p v-if="!operation?.fields.length && !provider?.fields.length" class="muted">此步骤没有可调参数。</p>
    <p v-if="!step.enabled" class="muted small">已停用的步骤不会执行，但参数仍会保存并校验。</p>

    <footer class="actions">
      <button type="button" class="button" :disabled="disabled || index === 0" @click="emit('move', -1)">上移</button>
      <button type="button" class="button" :disabled="disabled || index === count - 1" @click="emit('move', 1)">下移</button>
      <button type="button" class="button" :disabled="disabled" @click="emit('update:modelValue', resetStep(definition, step))">恢复默认参数</button>
      <button type="button" class="button danger end" :disabled="disabled" @click="emit('remove')">删除步骤</button>
    </footer>
  </article>
</template>

<style scoped>
.editor { display: grid; gap: var(--s-5); }
.head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--s-4); flex-wrap: wrap; }
.order { color: var(--ink-2); }
h2 { font-size: var(--t-heading); }
.switch { padding: var(--s-1) 0; font-weight: 500; }
.combo { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-4); }
.about { color: var(--ink-2); max-width: 60ch; }
.group { display: grid; gap: var(--s-3); padding-top: var(--s-4); border-top: 1px solid var(--rule-soft); }
h3 { font-size: var(--t-body); }
.actions { display: flex; flex-wrap: wrap; gap: var(--s-2); padding-top: var(--s-4); border-top: 1px solid var(--rule-soft); }
.end { margin-left: auto; }
@media (max-width: 760px) { .combo { grid-template-columns: 1fr; } }
</style>
