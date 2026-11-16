<script setup lang="ts">
// 下拉选择：行为（键盘导航、键入定位、浮层定位、焦点管理）由 Reka UI 提供，外观全部来自本项目的令牌。
// 触发按钮沿用 .select 的外观；弹出列表挂在 body 上，样式在 styles/base.css 的 .select-popup 中。
import { computed } from 'vue';
import { SelectContent, SelectGroup, SelectItem, SelectItemIndicator, SelectItemText, SelectLabel, SelectPortal, SelectRoot, SelectTrigger, SelectValue, SelectViewport } from 'reka-ui';
import Icon from './Icon.vue';

export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectOptionGroup { label: string; items: SelectOption[] }
export type SelectEntry = SelectOption | SelectOptionGroup;

defineOptions({ inheritAttrs: false });
const props = defineProps<{ modelValue: string; options: SelectEntry[]; id?: string; disabled?: boolean; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const isGroup = (entry: SelectEntry): entry is SelectOptionGroup => 'items' in entry;
// 空字符串表示“尚未选择”：不作为选项出现，由占位文字表达。
const usable = (item: SelectOption) => item.value !== '';
const flat = computed(() => props.options.flatMap(entry => isGroup(entry) ? entry.items : [entry]));
const selectedLabel = computed(() => flat.value.find(item => item.value === props.modelValue && usable(item))?.label);
</script>

<template>
  <SelectRoot :model-value="selectedLabel === undefined ? undefined : modelValue" :disabled="disabled" @update:model-value="emit('update:modelValue', String($event))">
    <SelectTrigger :id="id" v-bind="$attrs" class="select select-trigger">
      <SelectValue :placeholder="placeholder || '请选择…'"><template v-if="selectedLabel !== undefined">{{ selectedLabel }}</template></SelectValue>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="select-popup" position="popper" align="start" :side-offset="2" :collision-padding="8">
        <SelectViewport class="select-viewport">
          <template v-for="entry in options" :key="isGroup(entry) ? `group:${entry.label}` : entry.value">
            <SelectGroup v-if="isGroup(entry)" class="select-group">
              <SelectLabel class="select-group-label">{{ entry.label }}</SelectLabel>
              <SelectItem v-for="item in entry.items.filter(usable)" :key="item.value" class="select-item" :value="item.value" :disabled="item.disabled" :data-value="item.value">
                <SelectItemIndicator class="select-check"><Icon name="check" :size="14" /></SelectItemIndicator>
                <SelectItemText>{{ item.label }}</SelectItemText>
              </SelectItem>
            </SelectGroup>
            <SelectItem v-else-if="usable(entry)" class="select-item" :value="entry.value" :disabled="entry.disabled" :data-value="entry.value">
              <SelectItemIndicator class="select-check"><Icon name="check" :size="14" /></SelectItemIndicator>
              <SelectItemText>{{ entry.label }}</SelectItemText>
            </SelectItem>
          </template>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
