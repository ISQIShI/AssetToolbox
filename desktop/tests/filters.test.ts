import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import FilterEditor from '../src/components/FilterEditor.vue';
import { definition, config as configuration } from './fixtures';
import { createStep, processingRequest, resetStep, retargetStep } from '../src/core/model';
import type { ResourceFilter } from '../src/core/types';

describe('共享属性过滤编辑器', () => {
    it('构造 AND/OR 组、选择代码目录属性并清除条件', async () => {
        const wrapper = mount(FilterEditor, { props: { properties: definition.properties, title: '来源过滤', hint: '来源排除不复制' } });
        const sync = async () => {
            const events = wrapper.emitted('update:modelValue')!;
            const next = events[events.length - 1]![0] as ResourceFilter;
            await wrapper.setProps({ modelValue: next }); return next;
        };
        expect(wrapper.text()).toContain('未设置条件');
        await wrapper.get('.add-group').trigger('click'); await sync();
        await wrapper.get('select.property').setValue('image-width'); await sync();
        await wrapper.get('input[type=number]').setValue('1024');
        const value = await sync(); expect(value.any[0]!.all[0]).toEqual({ property: 'image-width', operator: 'gte', value: 1024 });
        await wrapper.get('.filter-group > button').trigger('click'); expect((await sync()).any[0]!.all).toHaveLength(2);
        await wrapper.get('.add-group').trigger('click'); expect((await sync()).any).toHaveLength(2);
        await wrapper.get('.filter-heading button').trigger('click'); expect((await sync()).any).toEqual([]);
    });
    it('步骤只列出适用属性，修改值移除旧版本，忙碌禁止编辑', async () => {
        const initial: ResourceFilter = { schema: 'asset-toolbox.filter/1', any: [{ all: [{ property: 'file-size', operator: 'gt', value: 1, version: '1.0.0' }] }] };
        const wrapper = mount(FilterEditor, { props: { properties: definition.properties, resourceType: 'mp3', modelValue: initial, title: '步骤过滤', hint: '' } });
        expect(wrapper.get('select.property').text()).not.toContain('图片');
        await wrapper.get('input').setValue('42');
        const next = wrapper.emitted('update:modelValue')![0]![0] as ResourceFilter;
        expect(next.any[0]!.all[0]!.version).toBeUndefined(); expect(initial.any[0]!.all[0]!.value).toBe(1);
        await wrapper.setProps({ disabled: true }); expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
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
