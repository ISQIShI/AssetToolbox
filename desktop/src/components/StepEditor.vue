<script setup lang="ts">
// 单个步骤的编辑器：标题与启用开关、步骤命令、组合（资源类型 / 操作 / 处理工具）、两组参数。
import { computed, useId } from 'vue';
import type { Definition, Step } from '../core/types';
import { isMissing, resetStep, retargetStep, stepTitle } from '../core/model';
import ParameterFields from './ParameterFields.vue';
import Icon from './Icon.vue';

const props = defineProps<{ definition: Definition; modelValue: Step; index: number; count: number; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: Step]; remove: []; move: [offset: number]; 'show-tools': [] }>();
const id = useId();

const step = computed(() => props.modelValue);
const operation = computed(() => props.definition.operations.find(item => item.id === step.value.operation));
const provider = computed(() => props.definition.providers.find(item => item.id === step.value.provider));
const adapter = computed(() => provider.value?.adapters.find(item => item.operation === step.value.operation));
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
        <h2>{{ stepTitle(definition, step) }}</h2>
        <p class="order">第 {{ index + 1 }} 步，共 {{ count }} 步</p>
      </div>
      <label class="check switch">
        启用此步骤
        <input type="checkbox" class="toggle" :checked="step.enabled" :disabled="disabled" @change="patch({ enabled: ($event.target as HTMLInputElement).checked })">
      </label>
    </header>

    <div class="commands" role="toolbar" aria-label="步骤命令">
      <button type="button" class="button small" :disabled="disabled || index === 0" @click="emit('move', -1)"><Icon name="up" :size="14" />上移</button>
      <button type="button" class="button small" :disabled="disabled || index === count - 1" @click="emit('move', 1)"><Icon name="down" :size="14" />下移</button>
      <button type="button" class="button small" :disabled="disabled" @click="emit('update:modelValue', resetStep(definition, step))"><Icon name="restore" :size="14" />恢复默认参数</button>
      <button type="button" class="button small danger end" :disabled="disabled" @click="emit('remove')"><Icon name="trash" :size="14" />删除步骤</button>
    </div>

    <div v-if="isMissing(provider)" class="callout missing" role="status">
      <span class="missing-swatch" aria-hidden="true"></span>
      <p><strong>{{ provider?.displayName }} 缺少依赖。</strong>{{ provider?.availability?.reason }}。安装后在“工具”页刷新，或停用此步骤。</p>
      <button type="button" class="button small" @click="emit('show-tools')">查看获取方式</button>
    </div>

    <section class="group combo" aria-label="步骤组合">
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
        <p class="hint about">{{ about }}</p>
      </div>
      <div class="field">
        <label class="label" :for="`${id}-provider`">处理工具</label>
        <select :id="`${id}-provider`" class="select" :value="step.provider" :disabled="disabled" @change="retarget(step.resourceType, step.operation, ($event.target as HTMLSelectElement).value)">
          <option v-for="item in providers" :key="item.id" :value="item.id">{{ item.displayName }}{{ isMissing(item) ? '（缺少依赖）' : '' }}</option>
        </select>
      </div>
    </section>

    <section v-if="operation?.fields.length" class="group">
      <h3>{{ operation.displayName }}参数</h3>
      <ParameterFields :id-prefix="`${id}-op`" :fields="operation.fields" :model-value="step.parameters" :disabled="locked" @update:model-value="patch({ parameters: $event })" />
    </section>
    <section v-if="adapter?.fields.length" class="group">
      <h3>{{ provider?.displayName }} · {{ operation?.displayName }}参数</h3>
      <ParameterFields :id-prefix="`${id}-tool`" :fields="adapter.fields" :model-value="step.providerOptions" :disabled="locked" @update:model-value="patch({ providerOptions: $event })" />
    </section>
    <p v-if="!operation?.fields.length && !adapter?.fields.length" class="muted">此步骤没有可调参数。</p>
    <p v-if="!step.enabled" class="muted small">已停用的步骤不会执行，但参数仍会保存并校验。</p>
  </article>
</template>

<style scoped>
.editor { display: grid; gap: var(--s-3); }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--s-4); }
.heading { display: grid; gap: 2px; min-width: 0; }
.order { color: var(--text-2); font-size: var(--t-small); }
.switch { flex: none; height: var(--control-small); color: var(--text-2); }
.commands { display: flex; flex-wrap: wrap; gap: var(--s-1); }
.end { margin-left: auto; }
.combo .select { max-width: 320px; }
</style>
