// 组件与纯函数：动态参数、步骤组合、恢复勾选、工具获取渠道、请求构造。
import { describe, it, expect, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import StepEditor from '../src/components/StepEditor.vue';
import RestoreTable from '../src/components/RestoreTable.vue';
import ToolsView from '../src/views/ToolsView.vue';
import { createWorkbench, workbenchKey } from '../src/core/workbench';
import { call, openProviderSource } from '../src/core/api';
import { config, definition, missingProvider, task } from './fixtures';
import { createStep, processingRequest, resetStep, retargetStep, sizeChange, stepGroups, taskStatus } from '../src/core/model';
import type { Step, RestoreFile, RestorePreview } from '../src/core/types';

vi.mock('../src/core/api', () => ({ call: vi.fn(), chooseFolder: vi.fn(), openReport: vi.fn(), openProviderSource: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {}, close: vi.fn() }) }));

const file = (path: string, state: RestoreFile['state'] = 'recoverable', queue: RestoreFile['queue'] = 'pending', inLastSelection = false): RestoreFile => ({ path, state, queue, inLastSelection, selectable: state === 'recoverable', backupHash: 'a'.repeat(64), targetHash: 'b'.repeat(64), backupBytes: 100, currentBytes: state === 'conflict' ? null : 10, reason: '测试说明' });
const preview: RestorePreview = { source: 'D:\\备份', destination: 'D:\\源', total: 5, checked: 5, recoverable: 3, restored: 1, conflict: 1, cancelled: false, files: [file('a.png', 'recoverable', 'pending', true), file('b.png', 'recoverable', 'failed', true), file('c.png'), file('done.png', 'restored'), file('conflict.png', 'conflict')] };
const lastEmitted = (wrapper: ReturnType<typeof mount>) => wrapper.emitted('update:modelValue')?.at(-1)?.[0] as Step;
const byLabel = (wrapper: ReturnType<typeof mount>, label: string) => {
    const target = wrapper.findAll('label').find(item => item.text().trim() === label)!;
    return wrapper.find(`[id="${target.attributes('for')}"]`);
};

describe('步骤编辑器', () => {
    it('renders namespaced fields from the catalog and emits edits into the right namespace', async () => {
        const step = config.pipeline[0]!;
        const wrapper = mount(StepEditor, { props: { definition, modelValue: step, index: 0, count: 1 } });
        expect(wrapper.findAll('input[type=number]')).toHaveLength(2);
        expect(wrapper.find('input[step="0.05"]').attributes('max')).toBe('1');
        expect(wrapper.text()).toContain('测试工具 · 压缩参数');
        await byLabel(wrapper, '模式').setValue('b');
        expect(lastEmitted(wrapper)).toMatchObject({ providerOptions: { mode: 'b' }, parameters: {} });
        const long = '中文'.repeat(7000); await byLabel(wrapper, '文字').setValue(long);
        expect(lastEmitted(wrapper).providerOptions.text).toBe(long);
        await byLabel(wrapper, '级别').setValue('');
        expect(lastEmitted(wrapper).providerOptions.level).toBe('');
    });

    it('locks parameters of a disabled step but keeps the combo editable, and retargeting keeps ID and switch', async () => {
        const step = { ...config.pipeline[0]!, enabled: false };
        const wrapper = mount(StepEditor, { props: { definition, modelValue: step, index: 0, count: 2 } });
        expect(wrapper.findAll('.parameters input').every(input => input.attributes('disabled') !== undefined)).toBe(true);
        expect(wrapper.text()).toContain('已停用的步骤不会执行');
        await byLabel(wrapper, '操作').setValue('image-resize');
        expect(lastEmitted(wrapper)).toMatchObject({ id: 'first', operation: 'image-resize', parameters: { width: 512 }, enabled: false });
        expect(resetStep(definition, step)).toMatchObject({ id: 'first', enabled: false, providerOptions: { level: 4, rate: .7 } });
    });

    it('offers move/remove only where valid and points missing tools to the tools page', async () => {
        const wrapper = mount(StepEditor, { props: { definition: { ...definition, providers: [missingProvider()] }, modelValue: config.pipeline[0]!, index: 0, count: 1 } });
        const button = (text: string) => wrapper.findAll('button').find(item => item.text() === text)!;
        expect(button('上移').attributes('disabled')).toBeDefined();
        expect(button('下移').attributes('disabled')).toBeDefined();
        expect(wrapper.find('.callout.missing').text()).toContain('缺少文件：tool.exe');
        await button('查看获取方式').trigger('click'); expect(wrapper.emitted('show-tools')).toHaveLength(1);
        await button('删除步骤').trigger('click'); expect(wrapper.emitted('remove')).toHaveLength(1);
    });

    it('switches adapters within one provider without leaking fields or options between operations', async () => {
        const wrapper = mount(StepEditor, { props: { definition, modelValue: config.pipeline[0]!, index: 0, count: 1 } });
        await byLabel(wrapper, '操作').setValue('image-resize');
        const resized = lastEmitted(wrapper);
        expect(resized.parameters).toEqual({ width: 512 });
        expect(resized.providerOptions).toEqual({ quality: 90 });
        await wrapper.setProps({ modelValue: resized });
        expect(wrapper.text()).toContain('缩放质量');
        expect(wrapper.text()).not.toContain('额外开关');
        await byLabel(wrapper, '缩放质量').setValue(71);
        expect(lastEmitted(wrapper).providerOptions).toEqual({ quality: 71 });
        await byLabel(wrapper, '操作').setValue('compress');
        expect(lastEmitted(wrapper).parameters).toEqual({});
        expect(lastEmitted(wrapper).providerOptions).toEqual({ level: 4, rate: .7, flag: false, mode: 'a', text: '默认' });
        wrapper.unmount();
    });

    it('preserves public parameters when changing tools for the same operation and resets only tool options', async () => {
        const catalog = structuredClone(definition);
        catalog.providers.push({ ...structuredClone(catalog.providers[0]!), id: 'other', displayName: '另一工具',
            supports: [{ resourceType: 'png', operation: 'image-resize' }],
            adapters: [{ operation: 'image-resize', version: '1.0.0', fields: [{ key: 'speed', label: '工具速度', type: 'integer', default: 3, min: 1, max: 9 }] }] });
        const original: Step = { ...createStep(catalog, 'png', 'image-resize', 'test'), enabled: false,
            parameters: { width: 256 }, providerOptions: { quality: 61 },
            versions: { resourceType: '1.0.0', operation: '1.0.0', provider: '1.0.0', adapter: '1.0.0' } };
        const wrapper = mount(StepEditor, { props: { definition: catalog, modelValue: original, index: 0, count: 1 } });
        await byLabel(wrapper, '处理工具').setValue('other');
        const changed = lastEmitted(wrapper);
        expect(changed).toMatchObject({ id: original.id, enabled: false, parameters: { width: 256 }, providerOptions: { speed: 3 } });
        expect(changed.versions).toBeUndefined();
        expect(changed.parameters).not.toBe(original.parameters);
        await wrapper.setProps({ modelValue: changed });
        expect(wrapper.text()).toContain('工具速度'); expect(wrapper.text()).not.toContain('缩放质量');
        await byLabel(wrapper, '处理工具').setValue('test');
        expect(lastEmitted(wrapper).parameters).toEqual({ width: 256 });
        expect(lastEmitted(wrapper).providerOptions).toEqual({ quality: 90 });
        expect(resetStep(catalog, changed).parameters).toEqual({ width: 512 });
        // 保留编辑值，不在换工具时静默修正；无效值仍交给核心校验。
        expect(retargetStep(catalog, { ...original, parameters: { width: '' } }, 'png', 'image-resize', 'other')?.parameters.width).toBe('');
        expect(retargetStep(catalog, original, 'png', 'compress', 'other')).toBeUndefined();
        expect(original.providerOptions).toEqual({ quality: 61 });
        wrapper.unmount();
    });
});

describe('恢复勾选', () => {
    it('filters without losing hidden checks, forbids conflicts/restored, keeps checks on recheck and emits hashes only for selected files', async () => {
        const wrapper = mount(RestoreTable, { props: { preview, scope: 'all' } });
        expect(wrapper.find('input[aria-label="恢复 conflict.png"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('input[aria-label="恢复 done.png"]').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).not.toContain('null B');
        await wrapper.find('input[aria-label="恢复 b.png"]').setValue(false);
        await wrapper.find('input[aria-label="搜索恢复文件"]').setValue('a.png');
        expect(wrapper.text()).toContain('其中 1 项被筛选隐藏');
        await wrapper.setProps({ preview: { ...preview, files: preview.files.map(row => ({ ...row })) } });
        await wrapper.find('button.primary').trigger('click');
        expect(wrapper.emitted('restore')?.[0]?.[0]).toEqual([preview.files[0], preview.files[2]].map(({ path, backupHash, targetHash }) => ({ path, backupHash, targetHash })));
    });

    it('state filters narrow the list and bulk selection only touches the filtered rows', async () => {
        const wrapper = mount(RestoreTable, { props: { preview, scope: 'all' } });
        await wrapper.findAll('.filter input')[3]!.setValue(true);
        expect(wrapper.findAll('tbody tr')).toHaveLength(1);
        await wrapper.findAll('.filter input')[1]!.setValue(true);
        await wrapper.findAll('button').find(item => item.text() === '取消勾选筛选结果')!.trigger('click');
        expect(wrapper.find('button.primary').text()).toBe('恢复所选 0 项');
        expect(wrapper.find('button.primary').attributes('disabled')).toBeDefined();
    });

    it('continue/retry preselect only their persisted queue and a cancelled check cannot restore', async () => {
        for (const [scope, path] of [['continue', 'a.png'], ['retry', 'b.png']] as const) {
            const wrapper = mount(RestoreTable, { props: { preview, scope } });
            await wrapper.find('button.primary').trigger('click');
            expect((wrapper.emitted('restore')?.[0]?.[0] as { path: string }[]).map(row => row.path)).toEqual([path]);
            await wrapper.setProps({ preview: { ...preview, cancelled: true } });
            expect(wrapper.find('button.primary').attributes('disabled')).toBeDefined();
            expect(wrapper.findAll('tbody input[type=checkbox]').every(input => input.attributes('disabled') !== undefined)).toBe(true);
        }
    });
});

describe('处理工具页', () => {
    it('keeps manual guidance without exposing an install button for unsupported providers', () => {
        const bench = createWorkbench();
        bench.boot.value = { config, definition: { ...definition, providers: [{ ...missingProvider(), dependency: { automatic: false, reason: '作者渠道尚未核验' } }] }, warnings: [] };
        const wrapper = mount(ToolsView, { global: { provide: { [workbenchKey as symbol]: bench } } });
        expect(wrapper.text()).toContain('手动安装：作者渠道尚未核验');
        expect(wrapper.find('.installation button').exists()).toBe(false);
        expect(wrapper.find('a').attributes('href')).toBe('https://example.com/download');
    });
    it('expands missing tools with acquisition details, opens sources by ID and refreshes availability', async () => {
        const bench = createWorkbench();
        bench.boot.value = { config, definition: { ...definition, providers: [missingProvider()] }, warnings: [] };
        vi.mocked(call).mockResolvedValue([{ ...definition.providers[0], availability: { available: true, reason: '' } }]);
        const wrapper = mount(ToolsView, { global: { provide: { [workbenchKey as symbol]: bench } } });
        expect(wrapper.find('details').attributes('open')).toBeDefined();
        expect(wrapper.text()).toContain('缺少文件：tool.exe'); expect(wrapper.text()).toContain('providers/test/');
        expect(wrapper.find('a').attributes('href')).toBe('https://example.com/download');
        await wrapper.find('a').trigger('click'); expect(openProviderSource).toHaveBeenCalledWith('test');
        await wrapper.findAll('button').find(item => item.text() === '刷新依赖状态')!.trigger('click'); await flushPromises();
        expect(call).toHaveBeenCalledWith('providers');
        expect(wrapper.text()).not.toContain('缺少文件'); expect(wrapper.text()).toContain('全部 1 个处理工具可用');
    });
});

describe('模型', () => {
    it('save-as excludes remembered backup, overwrite backup is explicit, and missing paths fail before dispatch', () => {
        expect(processingRequest({ ...config, saveMode: 'saveAs' }, 'process')).not.toHaveProperty('backupDir');
        expect(processingRequest(config, 'preview')).toMatchObject({ backupDir: config.backupDir });
        expect(processingRequest({ ...config, backupEnabled: false }, 'preview')).not.toHaveProperty('backupDir');
        expect(processingRequest({ ...config, sourceDir: '"D:\\带引号"' }, 'preview').folder).toBe('D:\\带引号');
        expect(() => processingRequest({ ...config, sourceDir: '' }, 'process')).toThrow('来源');
        expect(() => processingRequest({ ...config, backupDir: '' }, 'process')).toThrow('备份');
        expect(() => processingRequest({ ...config, saveMode: 'saveAs', outputDir: ' ' }, 'process')).toThrow('另存');
    });

    it('formats size changes with explicit direction and lists only supported combos', () => {
        expect(sizeChange(2048)).toBe('−2.0 KB');
        expect(sizeChange(-100)).toBe('+100 B');
        expect(sizeChange(0)).toBe('0 B');
        expect(stepGroups(definition).map(item => [item.operation.displayName, item.resourceTypes.map(type => type.id)])).toEqual([['压缩', ['png']], ['图片缩放', ['png']]]);
        expect(taskStatus(task)).toEqual({ label: '可继续', tone: 'warn' });
        expect(taskStatus({ ...task, canResume: false, failed: 0 })).toEqual({ label: '已完成', tone: 'ok' });
    });

    it('groups dynamic operations without duplicate providers or unsupported formats, retaining missing tools', () => {
        const custom = { ...definition.operations[0]!, id: 'custom', displayName: '扩展操作' };
        const groups = stepGroups({
            ...definition,
            resourceTypes: [...definition.resourceTypes, definition.resourceTypes[0]!, { ...definition.resourceTypes[0]!, id: 'other' }],
            operations: [...definition.operations, custom, custom, { ...custom, id: 'unsupported' }],
            providers: [definition.providers[0]!, definition.providers[0]!, { ...missingProvider(), supports: [{ resourceType: 'png', operation: 'custom' }] }],
        });
        expect(groups.map(group => group.operation.id)).toEqual(['compress', 'image-resize', 'custom']);
        expect(groups.every(group => group.resourceTypes.length === 1 && group.resourceTypes[0]!.id === 'png')).toBe(true);
    });
});
