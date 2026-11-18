import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import FilterEditor from '../src/components/FilterEditor.vue';
import { definition, config as configuration } from './fixtures';
import { createStep, processingRequest, resetStep, retargetStep } from '../src/core/model';
import { choose, optionGroups, optionLabels, selectBox, selectBoxes } from './select';
import type { ResourceFilter } from '../src/core/types';

describe('共享属性过滤编辑器', () => {
    it('构造 AND/OR 组、选择代码目录属性并清除条件', async () => {
        const wrapper = mount(FilterEditor, { props: { properties: definition.properties, title: '来源过滤', hint: '来源排除不复制' } });
        const sync = async () => {
            const events = wrapper.emitted('update:modelValue')!;
            const next = events[events.length - 1]![0] as ResourceFilter;
            await wrapper.setProps({ modelValue: next }); return next;
        };
        expect(wrapper.text()).toContain('未设置，全部通过');
        expect(wrapper.get('button.info').attributes('aria-label')).toBe('来源过滤说明');
        await wrapper.get('.add-group').trigger('click'); await sync();
        const first = selectBox(wrapper, 'property').props('modelValue');
        expect(definition.properties.find(property => property.id === first)?.group).toBe('file');
        expect(optionGroups(selectBox(wrapper, 'property')).map(group => group.label)).toEqual(['通用文件属性', '图片属性', '音频属性']);
        expect(optionGroups(selectBox(wrapper, '比较 1-1'))).toEqual([]);
        await choose(selectBox(wrapper, 'property'), 'image-width'); await sync();
        await wrapper.get('input[type=number]').setValue('1024');
        const value = await sync(); expect(value.any[0]!.all[0]).toEqual({ property: 'image-width', operator: 'gte', value: 1024 });
        await wrapper.get('.filter-group > button').trigger('click'); expect((await sync()).any[0]!.all).toHaveLength(2);
        await wrapper.get('.add-group').trigger('click'); expect((await sync()).any).toHaveLength(2);
        await wrapper.get('.filter-heading .button').trigger('click'); expect((await sync()).any).toEqual([]);
    });
    it('WAV、FLAC 步骤可按秒、Hz 和声道筛选，其他格式只显示适用的属性', async () => {
        const modelValue: ResourceFilter = { schema: 'asset-toolbox.filter/1', any: [{ all: [{ property: 'audio-duration', operator: 'lt', value: 1 }] }] };
        const wrapper = mount(FilterEditor, { props: { modelValue, properties: definition.properties, resourceType: 'wav', title: '步骤过滤', hint: '' } });
        for (const resourceType of ['wav', 'flac']) {
            await wrapper.setProps({ resourceType });
            const property = selectBox(wrapper, 'property');
            expect(optionGroups(property).map(group => group.label)).toEqual(['通用文件属性', '音频属性']);
            expect(optionLabels(property)).toEqual(expect.arrayContaining(['音频时长 (s)', '采样率 (Hz)', '声道数']));
            await wrapper.get('input[type="number"]').setValue('0.125');
            expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject({ any: [{ all: [{ property: 'audio-duration', operator: 'lt', value: 0.125 }] }] });
        }
        for (const resourceType of ['mp3', 'ogg', 'png']) {
            await wrapper.setProps({ resourceType });
            expect(optionLabels(selectBox(wrapper, 'property'))).not.toContain('音频属性');
        }
    });
    it('步骤只列出适用属性，修改值移除旧版本，忙碌禁止编辑', async () => {
        const initial: ResourceFilter = { schema: 'asset-toolbox.filter/1', any: [{ all: [{ property: 'file-size', operator: 'gt', value: 1, version: '1.0.0' }] }] };
        const wrapper = mount(FilterEditor, { props: { properties: definition.properties, resourceType: 'mp3', modelValue: initial, title: '步骤过滤', hint: '' } });
        expect(optionLabels(selectBox(wrapper, 'property')).join()).not.toContain('图片');
        await wrapper.get('input').setValue('42');
        const next = wrapper.emitted('update:modelValue')![0]![0] as ResourceFilter;
        expect(next.any[0]!.all[0]!.version).toBeUndefined(); expect(initial.any[0]!.all[0]!.value).toBe(1);
        await wrapper.setProps({ disabled: true }); expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
        expect(selectBoxes(wrapper).every(box => box.props('disabled'))).toBe(true);
        expect(wrapper.get('.add-group').attributes('disabled')).toBeDefined();
    });
    it('来源过滤随公共请求发送，变更不会被桌面吞掉', () => {
        const sourceFilter: ResourceFilter = { schema: 'asset-toolbox.filter/1', any: [{ all: [{ property: 'file-size', operator: 'gt', value: 100 }] }] };
        expect(processingRequest({ ...configuration, sourceFilter }, 'preview', definition).sourceFilter).toEqual(sourceFilter);
    });
    it('切换同类型的工具和恢复参数时保留过滤，切换资源类型时重置', () => {
        const filter: ResourceFilter = { schema: 'asset-toolbox.filter/1', any: [{ all: [{ property: 'image-width', operator: 'gt', value: 100 }] }] };
        const original = { ...createStep(definition, 'png', 'compress'), filter };
        expect(retargetStep(definition, original, 'png')!.filter).toEqual(filter);
        expect(resetStep(definition, original).filter).toEqual(filter);
        const alternate = structuredClone(definition);
        alternate.providers[0]!.supports.push({ resourceType: 'jpg', operation: 'compress' });
        expect(retargetStep(alternate, original, 'jpg')!.filter).toBeUndefined();
    });
});
