// 测试辅助：SelectBox 的弹出列表由 Reka UI 挂到 body，jsdom 中不模拟指针与浮层交互。
// 组件测试通过 SelectBox 的公开契约（options、modelValue、update:modelValue）验证本项目的逻辑；
// 真实的点开、键盘和点击选项由原生 E2E 覆盖（见 native-select.ts）。
import { nextTick } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import SelectBox, { type SelectEntry, type SelectOption } from '../src/components/SelectBox.vue';

type Box = VueWrapper<InstanceType<typeof SelectBox>>;

export const selectBoxes = (wrapper: VueWrapper): Box[] => wrapper.findAllComponents(SelectBox) as Box[];

/** 按 id、类名或关联的 <label> 文字找到一个下拉框。 */
export function selectBox(wrapper: VueWrapper, match: string): Box {
    const labelled = wrapper.findAll('label').find(item => item.text().trim() === match)?.attributes('for');
    const found = selectBoxes(wrapper).find(box => box.props('id') === match || (labelled && box.props('id') === labelled) || String(box.vm.$attrs.class || '').split(' ').includes(match));
    if (!found) throw new Error(`找不到下拉框：${match}`);
    return found;
}

export async function choose(box: Box, value: string) { box.vm.$emit('update:modelValue', value); await nextTick(); }

export const optionGroups = (box: Box) => (box.props('options') as SelectEntry[]).filter((entry): entry is { label: string; items: SelectOption[] } => 'items' in entry);
export const optionLabels = (box: Box) => (box.props('options') as SelectEntry[]).flatMap(entry => 'items' in entry ? [entry.label, ...entry.items.map(item => item.label)] : [entry.label]);
