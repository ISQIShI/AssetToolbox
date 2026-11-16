<script setup lang="ts">
// 单个步骤的编辑器：标题与启用开关、步骤命令、组合（资源类型 / 操作 / 处理工具）、两组参数。
import { computed, useId } from 'vue';
import type { Definition, Step } from '../core/types';
import { isMissing, resetStep, retargetStep, stepTitle } from '../core/model';
import ParameterFields from './ParameterFields.vue';
import Icon from './Icon.vue';
import SelectBox from './SelectBox.vue';
import Tip from './Tip.vue';
import FilterEditor from './FilterEditor.vue';
import { resourceGroups } from '../core/resource-groups';

const props = defineProps<{ definition: Definition; modelValue: Step; index: number; count: number; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: Step]; remove: []; move: [offset: number]; 'show-tools': [] }>();
const id = useId();

const step = computed(() => props.modelValue);
const categories = computed(() => resourceGroups(props.definition.resourceTypes));
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
      <div class="commands" role="toolbar" aria-label="步骤命令">
        <Tip text="上移" shortcut="Alt+↑"><button type="button" class="button quiet icon-only" aria-label="上移" :disabled="disabled || index === 0" @click="emit('move', -1)"><Icon name="up" /></button></Tip>
        <Tip text="下移" shortcut="Alt+↓"><button type="button" class="button quiet icon-only" aria-label="下移" :disabled="disabled || index === count - 1" @click="emit('move', 1)"><Icon name="down" /></button></Tip>
        <Tip text="恢复默认参数"><button type="button" class="button quiet icon-only" aria-label="恢复默认参数" :disabled="disabled" @click="emit('update:modelValue', resetStep(definition, step))"><Icon name="restore" /></button></Tip>
        <Tip text="删除步骤…"><button type="button" class="button quiet icon-only danger" aria-label="删除步骤" :disabled="disabled" @click="emit('remove')"><Icon name="trash" /></button></Tip>
        <span class="divider" aria-hidden="true"></span>
        <label class="check switch">
          启用
          <input type="checkbox" class="toggle" aria-label="启用此步骤" :checked="step.enabled" :disabled="disabled" @change="patch({ enabled: ($event.target as HTMLInputElement).checked })">
        </label>
      </div>
    </header>

    <div v-if="isMissing(provider)" class="callout missing" role="status">
      <span class="missing-swatch" aria-hidden="true"></span>
      <p><strong>{{ provider?.displayName }} 缺少依赖。</strong>{{ provider?.availability?.reason }}。安装后在“工具”页刷新，或停用此步骤。</p>
      <button type="button" class="button small" @click="emit('show-tools')">查看获取方式</button>
    </div>

    <section class="group combo" aria-label="步骤组合">
      <div class="field">
        <label class="label" :for="`${id}-type`">资源格式</label>
        <SelectBox :id="`${id}-type`" :model-value="step.resourceType" :options="categories.map(group => ({ label: group.label, items: group.items.map(type => ({ value: type.id, label: type.displayName })) }))" :disabled="disabled" @update:model-value="retarget($event)" />
      </div>
      <div class="field">
        <label class="label" :for="`${id}-operation`">操作</label>
        <SelectBox :id="`${id}-operation`" :model-value="step.operation" :options="operations.map(item => ({ value: item.id, label: item.displayName }))" :disabled="disabled" @update:model-value="retarget(step.resourceType, $event)" />
        <p class="hint about">{{ about }}</p>
      </div>
      <div class="field">
        <label class="label" :for="`${id}-provider`">处理工具</label>
        <SelectBox :id="`${id}-provider`" :model-value="step.provider" :options="providers.map(item => ({ value: item.id, label: item.displayName + (isMissing(item) ? '（缺少依赖）' : '') }))" :disabled="disabled" @update:model-value="retarget(step.resourceType, step.operation, $event)" />
      </div>
    </section>

    <FilterEditor :properties="definition.properties" :resource-types="definition.resourceTypes" :resource-type="step.resourceType" :model-value="step.filter" :disabled="locked" title="步骤过滤" hint="只对满足条件的当前输入执行此步骤；前一步改变尺寸后按新尺寸判断。未匹配仅跳过本步骤。" @update:model-value="patch({ filter: $event })" />
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
.commands { flex: none; display: flex; align-items: center; gap: 2px; }
.divider { width: 1px; height: 16px; margin: 0 var(--s-2); background: var(--border); }
.switch { flex: none; color: var(--text-2); }
</style>
