import { expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { resourceGroups } from '../src/core/resource-groups';
import type { ResourceFilter, ResourceType, ScanPreview } from '../src/core/types';
import { previewProperties } from '../src/core/preview-properties';
import { choose, optionGroups, optionLabels, selectBoxes } from './select';
import FilterEditor from '../src/components/FilterEditor.vue';
import RunInspector from '../src/components/RunInspector.vue';
import { ref } from 'vue';
import { workbenchKey } from '../src/core/workbench';

const types: ResourceType[] = [
    { id: 'mp3', displayName: 'MP3', kind: 'audio', extensions: ['.mp3'], version: '1.0.0' },
    { id: 'jpg', displayName: 'JPEG', kind: 'image', extensions: ['.jpg', '.jpeg'], version: '1.0.0' },
    { id: 'png', displayName: 'PNG', kind: 'image', extensions: ['.png'], version: '1.0.0' },
    { id: 'mesh', displayName: 'Mesh', kind: 'model', extensions: ['.mesh'], version: '1.0.0' },
];
it('groups by declared kind, preserves individual formats and keeps future categories visible', () => {
    const before = structuredClone(types);
    expect(resourceGroups(types).map(group => [group.id, group.label, group.items.map(type => type.id)])).toEqual([
        ['image', '图片', ['jpg', 'png']], ['audio', '音频', ['mp3']], ['model', 'model', ['mesh']],
    ]);
    expect(types).toEqual(before); expect(resourceGroups([])).toEqual([]);
});
it('uses Chinese categories and grouped formats while emitting unchanged core IDs and preserving unknown values', async () => {
    const initial: ResourceFilter = { schema: 'asset-toolbox.filter/1', any: [{ all: [{ property: 'resource-kind', operator: 'eq', value: 'image', version: '1.0.0' }] }] };
    const wrapper = mount(FilterEditor, { props: { modelValue: initial, properties: previewProperties, resourceTypes: types, title: '来源过滤', hint: '' } });
    const selects = () => selectBoxes(wrapper);
    expect(optionLabels(selects()[2]!)).toContain('图片');
    await choose(selects()[2]!, 'audio');
    const next = wrapper.emitted('update:modelValue')!.at(-1)![0] as ResourceFilter;
    expect(next.any[0]!.all[0]).toEqual({ property: 'resource-kind', operator: 'eq', value: 'audio' });
    await wrapper.setProps({ modelValue: { ...initial, any: [{ all: [{ property: 'resource-type', operator: 'ne', value: 'removed-format' }] }] } });
    expect(optionGroups(selects()[2]!).map(group => group.label)).toEqual(['图片', '音频', 'model']);
    expect(selects()[2]!.props('modelValue')).toBe('removed-format');
    expect(optionLabels(selects()[2]!)[0]).toBe('removed-format（目录外的值）'); expect(wrapper.text()).toContain('removed-format（目录外的值）');
    await choose(selects()[2]!, 'jpg');
    expect((wrapper.emitted('update:modelValue')!.at(-1)![0] as ResourceFilter).any[0]!.all[0]!.value).toBe('jpg');
    wrapper.unmount();
});
it('keeps substring filters as text instead of restricting them to catalog choices', () => {
    const wrapper = mount(FilterEditor, { props: { modelValue: { schema: 'asset-toolbox.filter/1', any: [{ all: [{ property: 'resource-kind', operator: 'contains', value: 'im' }] }] }, properties: previewProperties, resourceTypes: types, title: '来源过滤', hint: '' } });
    expect(wrapper.get('input').element.value).toBe('im'); wrapper.unmount();
});
it('aggregates scan groups without merging file-level format counts or losing unknown resources', () => {
    const scan: ScanPreview = { total: 6, checked: 6, totalBytes: 60, enabledFiles: 3, conflicts: 0, issues: [], cancelled: false, resources: [
        { id: 'jpg', name: 'JPEG', enabled: true, count: 1, bytes: 10 },
        { id: 'png', name: 'PNG', enabled: true, count: 2, bytes: 20 },
        { id: 'gone', name: '旧目录格式', enabled: false, count: 3, bytes: 30 },
    ] };
    // 概览栏只读取工作台的这几项状态。
    const bench = { config: ref({ pipeline: [{ enabled: true, resourceType: 'png' }, { enabled: false, resourceType: 'jpg' }] }), definition: ref({ resourceTypes: types }), scan: ref(scan), scanStale: ref(false), busy: ref(false), job: ref(undefined), runPipeline: () => {} };
    const wrapper = mount(RunInspector, { global: { provide: { [workbenchKey as symbol]: bench } } });
    const image = wrapper.get('tbody[aria-label="图片"]');
    expect(image.findAll('tr')).toHaveLength(3); expect(image.get('.resource-group').text()).toContain('30 B');
    // 每行依次是：启用的步骤数、文件数、体积；停用的步骤不计数。
    expect(image.findAll('td.number').map(cell => cell.text())).toEqual(['—', '1', '10 B', '1', '2', '20 B']);
    expect(wrapper.get('tbody[aria-label="音频"]').findAll('td.number').map(cell => cell.text())).toEqual(['—', '0', '—']);
    expect(wrapper.get('tbody[aria-label="其他"]').text()).toContain('旧目录格式');
    expect(wrapper.get('tbody[aria-label="其他"]').text()).toContain('30 B');
    expect(scan.resources).toHaveLength(3); wrapper.unmount();
});
