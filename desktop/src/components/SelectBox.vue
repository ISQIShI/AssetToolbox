<script setup lang="ts">
// 下拉选择：行为（键盘导航、键入定位、浮层定位、焦点管理）由 Reka UI 提供，外观全部来自本项目的令牌。
// 触发按钮沿用 .select 的外观；弹出列表挂在 body 上，样式在 styles/base.css 的 .select-popup 中。
import { computed, ref, useId, watch } from 'vue';
import { SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectPortal, SelectRoot, SelectTrigger, SelectValue, SelectViewport, DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent } from 'reka-ui';
import Icon from './Icon.vue';
import SelectMenuItems from './SelectMenuItems.vue';
import { flattenOptions, isSelectGroup, type SelectOption, type SelectEntry } from '../core/select-options';
export type { SelectOption, SelectOptionGroup, SelectEntry } from '../core/select-options';

defineOptions({ inheritAttrs: false });
const props = defineProps<{ modelValue: string; options: SelectEntry[]; id?: string; disabled?: boolean; placeholder?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
const generatedId = useId();
const triggerId = computed(() => props.id || generatedId);

const open = ref(false);
const hierarchical = computed(() => props.options.some(isSelectGroup));
watch(() => props.disabled, value => { if (value) open.value = false; });
// 空字符串表示“尚未选择”：不作为选项出现，由占位文字表达。
const usable = (item: SelectOption) => item.value !== '';
const flat = computed(() => flattenOptions(props.options));
const selectedLabel = computed(() => flat.value.find(item => item.value === props.modelValue && usable(item))?.label);
</script>

<template>
  <DropdownMenuRoot v-if="hierarchical" v-model:open="open" :modal="false">
    <DropdownMenuTrigger as-child :disabled="disabled">
      <button :id="triggerId" v-bind="$attrs" type="button" class="select select-trigger" :disabled="disabled"><span>{{ selectedLabel ?? placeholder ?? '请选择…' }}</span></button>
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent class="cascade-popup cascade-root" :aria-labelledby="triggerId" align="start" :side-offset="2" :collision-padding="8" loop>
        <SelectMenuItems :options="options" :model-value="modelValue" @choose="emit('update:modelValue', $event)" />
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
  <SelectRoot v-else :model-value="selectedLabel === undefined ? undefined : modelValue" :disabled="disabled" @update:model-value="emit('update:modelValue', String($event))">
    <SelectTrigger :id="id" v-bind="$attrs" class="select select-trigger">
      <SelectValue :placeholder="placeholder || '请选择…'"><template v-if="selectedLabel !== undefined">{{ selectedLabel }}</template></SelectValue>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="select-popup" position="popper" align="start" :side-offset="2" :collision-padding="8">
        <SelectViewport class="select-viewport">
          <SelectItem v-for="entry in flat.filter(usable)" :key="entry.value" class="select-item" :value="entry.value" :disabled="entry.disabled" :data-value="entry.value">
            <SelectItemIndicator class="select-check"><Icon name="check" :size="14" /></SelectItemIndicator>
            <SelectItemText>{{ entry.label }}</SelectItemText>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
