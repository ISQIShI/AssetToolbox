<script setup lang="ts">
import { computed, useId } from 'vue';
import type { FilterRule, ResourceFilter, ResourceProperty, ResourceType } from '../core/types';
import { resourceGroups, groupByResourceKind, resourceKindLabel } from '../core/resource-groups';
import SelectBox, { type SelectEntry } from './SelectBox.vue';
import Tip from './Tip.vue';
import Icon from './Icon.vue';
const props = defineProps<{ modelValue?: ResourceFilter; properties: ResourceProperty[]; resourceTypes?: ResourceType[]; resourceType?: string; disabled?: boolean; title: string; hint: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: ResourceFilter] }>();
const id = useId();
const filter = computed<ResourceFilter>(() => props.modelValue || { schema: 'asset-toolbox.filter/1', any: [] });
const fields = computed(() => props.properties.filter(field => !props.resourceType || field.resourceTypes.includes(props.resourceType)));
const count = computed(() => filter.value.any.reduce((sum, group) => sum + group.all.length, 0));
const labels: Record<string, string> = { eq: '等于', ne: '不等于', gt: '大于', gte: '大于或等于', lt: '小于', lte: '小于或等于', contains: '包含', 'starts-with': '开头是', 'ends-with': '结尾是' };
const fieldOf = (rule: FilterRule) => fields.value.find(field => field.id === rule.property);
const categories = computed(() => resourceGroups(props.resourceTypes || []));
const catalogValue = (rule: FilterRule) => categories.value.length && ['eq', 'ne'].includes(rule.operator) && ['resource-kind', 'resource-type'].includes(rule.property);
const knownValue = (rule: FilterRule) => rule.property === 'resource-kind' ? categories.value.some(group => group.id === rule.value) : props.resourceTypes?.some(type => type.id === rule.value);
// 目录值的选项：类别直接列出；格式按类别分组。目录外的旧值保留为一个可见选项，避免静默丢失。
function catalogOptions(rule: FilterRule): SelectEntry[] {
    const unknown: SelectEntry[] = knownValue(rule) || rule.value === '' ? [] : [{ value: String(rule.value), label: `${rule.value}（目录外的值）` }];
    if (rule.property === 'resource-kind') return [...unknown, ...categories.value.map(group => ({ value: group.id, label: group.label }))];
    return [...unknown, ...categories.value.map(group => ({ label: group.label, items: group.items.map(type => ({ value: type.id, label: type.displayName })) }))];
}
const fieldLabel = (field: ResourceProperty) => field.id === 'resource-kind' ? '资源类别' : field.id === 'resource-type' ? '资源格式' : field.label;
const propertyOptions = computed<SelectEntry[]>(() => groupByResourceKind(fields.value, field => field.group).sort((a, b) => Number(b.id === 'file') - Number(a.id === 'file')).map(group => ({
    label: group.id === 'file' ? '通用文件属性' : group.id === 'image' ? '图片属性' : group.id === 'audio' ? '音频属性' : `${resourceKindLabel(group.id)} 属性`,
    items: group.items.map(field => ({ value: field.id, label: fieldLabel(field) + (field.unit ? ` (${field.unit})` : '') })),
})));
function update(change: (next: ResourceFilter) => void) {
    const next = structuredClone(JSON.parse(JSON.stringify(filter.value))) as ResourceFilter;
    change(next); emit('update:modelValue', next);
}
function newRule(property = (fields.value.find(field => field.group === 'file') ?? fields.value[0])?.id): FilterRule {
    const field = fields.value.find(item => item.id === property)!;
    return { property: field.id, operator: field.type === 'number' ? 'gte' : 'eq', value: field.type === 'number' ? 0 : field.type === 'boolean' ? true : '' };
}
function patch(group: number, index: number, change: Partial<FilterRule>) {
    update(next => { const rule = next.any[group]!.all[index]!; delete rule.version; Object.assign(rule, change); });
}
function remove(group: number, index: number) {
    update(next => { next.any[group]!.all.splice(index, 1); if (!next.any[group]!.all.length) next.any.splice(group, 1); });
}
</script>

<template>
  <section class="group filter-editor" :aria-label="title">
    <header class="filter-heading"><h3>{{ title }}</h3><Tip v-if="hint" :text="hint"><button type="button" class="info" :aria-label="`${title}说明`"><Icon name="info" /></button></Tip><span v-if="!filter.any.length" class="muted small state">未设置，全部通过</span><button v-if="filter.any.length" type="button" class="button quiet small" :disabled="disabled" @click="update(next => { next.any = []; })">清除条件</button></header>
    <fieldset v-for="(group, gi) in filter.any" :key="gi" class="filter-group" :disabled="disabled">
      <legend>{{ gi ? '或：' : '' }}第 {{ gi + 1 }} 组 · 以下条件全部满足</legend>
      <div v-for="(rule, ri) in group.all" :key="ri" class="filter-rule">
        <label class="visually-hidden" :for="`${id}-${gi}-${ri}-property`">属性 {{ gi + 1 }}-{{ ri + 1 }}</label>
        <SelectBox :id="`${id}-${gi}-${ri}-property`" class="property" :disabled="disabled" :model-value="rule.property" :options="propertyOptions" @update:model-value="update(next => { next.any[gi]!.all[ri] = newRule($event); })" />
        <label class="visually-hidden" :for="`${id}-${gi}-${ri}-operator`">比较 {{ gi + 1 }}-{{ ri + 1 }}</label>
        <SelectBox :id="`${id}-${gi}-${ri}-operator`" :disabled="disabled" :model-value="rule.operator" :options="(fieldOf(rule)?.operators || []).map(op => ({ value: op, label: labels[op] || op }))" @update:model-value="patch(gi, ri, { operator: $event })" />
        <label class="visually-hidden" :for="`${id}-${gi}-${ri}-value`">值 {{ gi + 1 }}-{{ ri + 1 }}</label>
        <SelectBox v-if="catalogValue(rule)" :id="`${id}-${gi}-${ri}-value`" :disabled="disabled" :model-value="String(rule.value)" :options="catalogOptions(rule)" @update:model-value="patch(gi, ri, { value: $event })" />
        <SelectBox v-else-if="fieldOf(rule)?.type === 'boolean'" :id="`${id}-${gi}-${ri}-value`" :disabled="disabled" :model-value="String(rule.value)" :options="[{ value: 'true', label: '是' }, { value: 'false', label: '否' }]" @update:model-value="patch(gi, ri, { value: $event === 'true' })" />
        <input v-else :id="`${id}-${gi}-${ri}-value`" class="input" :type="fieldOf(rule)?.type === 'number' ? 'number' : 'text'" step="any" maxlength="1024" :value="rule.value" @input="patch(gi, ri, { value: fieldOf(rule)?.type === 'number' ? Number(($event.target as HTMLInputElement).value) : ($event.target as HTMLInputElement).value })">
        <button type="button" class="button quiet small" :aria-label="`删除条件 ${gi + 1}-${ri + 1}`" @click="remove(gi, ri)">删除</button>
      </div>
      <button type="button" class="button small" :disabled="!fields.length || group.all.length >= 16 || count >= 64" @click="update(next => next.any[gi]!.all.push(newRule()))">且：添加条件</button>
    </fieldset>
    <button type="button" class="button small add-group" :disabled="disabled || !fields.length || filter.any.length >= 16 || count >= 64" @click="update(next => next.any.push({ all: [newRule()] }))">{{ filter.any.length ? '或：添加条件组' : '添加过滤条件' }}</button>
    <p v-if="filter.any.length" class="hint">任一组匹配即可通过。字符串区分大小写；扩展名用小写。属性不适用时不匹配，读取失败会明确报错。</p>
  </section>
</template>

<style scoped>
.filter-editor { min-width: 0; }
.filter-heading { display: flex; align-items: center; gap: var(--s-2); min-height: var(--control-small); }
.filter-heading > .button { margin-left: auto; }
.info { display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 50%; background: none; color: var(--text-3); }
.info:hover { color: var(--text); background: var(--hover); }
.state { margin-left: auto; }
.filter-group { min-width: 0; margin: 0; padding: var(--s-2) var(--s-3) var(--s-3); border: 0; border-radius: var(--r-control); background: var(--surface); display: grid; gap: var(--s-2); }
.filter-group legend { color: var(--text-2); font-size: var(--t-small); padding: 0 var(--s-1); }
.filter-rule { display: grid; grid-template-columns: minmax(0, 1fr) minmax(80px, .7fr) minmax(60px, .6fr) auto; gap: var(--s-1); }
.filter-rule .input, .filter-rule :deep(.select) { width: 100%; min-width: 0; }
.filter-group > .button, .add-group { justify-self: start; }
@container editor (max-width: 520px) { .filter-rule { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; } .filter-rule :deep(.property) { grid-column: 1 / -1; } }
</style>
