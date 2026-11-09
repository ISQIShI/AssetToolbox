import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ModuleCard from '../src/ModuleCard.vue';
import RestoreTable from '../src/RestoreTable.vue';
import { compressionRequest, resetParameters } from '../src/model';
import type { Configuration, Definition, Module, RestoreFile, RestorePreview } from '../src/types';
const config: Configuration = { version: 1, sourceDir: 'D:\\中文 素材', saveMode: 'overwrite', outputDir: 'D:\\输出', backupDir: 'D:\\备份', backupEnabled: true, extraEnabled: true, level: 3, rate: .5, flag: false, mode: 'a', text: '长文本' };
const module: Module = { id: 'extra', displayName: '新压缩器', extensions: ['.pack'], enabledKey: 'extraEnabled', fields: [
    { key: 'extraEnabled', label: '启用', type: 'boolean', default: true, isEnable: true },
    { key: 'level', label: '级别', type: 'integer', default: 4, min: 1, max: 9, isEnable: false },
    { key: 'rate', label: '比例', type: 'number', default: .7, min: 0, max: 1, step: .05, decimalPlaces: 2, isEnable: false },
    { key: 'flag', label: '额外开关', type: 'boolean', default: false, isEnable: false },
    { key: 'mode', label: '模式', type: 'enum', default: 'a', choices: [{ label: '快速', value: 'a' }, { label: '最佳', value: 'b' }], isEnable: false },
    { key: 'text', label: '文字', type: 'text', default: '默认', maxLength: 32767, isEnable: false },
] };
const file = (path: string, state: RestoreFile['state'] = 'recoverable', queue: RestoreFile['queue'] = 'pending', inLastSelection = false): RestoreFile => ({ path, state, queue, inLastSelection, selectable: state === 'recoverable', backupHash: 'a'.repeat(64), targetHash: 'b'.repeat(64), backupBytes: 100, currentBytes: state === 'conflict' ? null : 10, reason: '测试说明' });
const preview: RestorePreview = { source: 'D:\\备份', destination: 'D:\\源', total: 5, checked: 5, recoverable: 3, restored: 1, conflict: 1, cancelled: false, files: [file('a.png', 'recoverable', 'pending', true), file('b.png', 'recoverable', 'failed', true), file('c.png'), file('done.png', 'restored'), file('conflict.png', 'conflict')] };
describe('动态模块与恢复交互', () => {
    it('renders all schema types, emits typed edits, disables module fields, resets parameters without changing enable/path choices', async () => {
        const wrapper = mount(ModuleCard, { props: { module, modelValue: config } });
        expect(wrapper.findAll('input[type=number]')).toHaveLength(2);
        expect(wrapper.find('input[step="0.05"]').attributes('max')).toBe('1');
        await wrapper.find('select').setValue('b');
        expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject({ mode: 'b', sourceDir: config.sourceDir });
        const long = '中文"\\'.repeat(7000); await wrapper.find('input[type=text]').setValue(long);
        expect((wrapper.emitted('update:modelValue')?.at(-1)?.[0] as Configuration).text).toBe(long);
        await wrapper.setProps({ modelValue: { ...config, extraEnabled: false } });
        expect(wrapper.findAll('input[type=number]').every(input => input.attributes('disabled') !== undefined)).toBe(true);
        const definition: Definition = { fields: module.fields, defaults: {}, modules: [module] };
        expect(resetParameters({ ...config, extraEnabled: false }, definition)).toMatchObject({ level: 4, rate: .7, extraEnabled: false, sourceDir: config.sourceDir, backupEnabled: true });
    });
    it('filters without losing hidden selection, forbids conflicts/restored, retains checks on refresh and emits hashes for selected files only', async () => {
        const wrapper = mount(RestoreTable, { props: { preview, scope: 'all' } });
        expect(wrapper.find('input[aria-label="恢复 conflict.png"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('input[aria-label="恢复 done.png"]').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).not.toContain('null B');
        await wrapper.find('input[aria-label="恢复 b.png"]').setValue(false);
        await wrapper.find('input[aria-label="搜索恢复文件"]').setValue('a.png');
        expect(wrapper.text()).toContain('1 项被筛选隐藏');
        await wrapper.setProps({ preview: { ...preview, files: preview.files.map(row => ({ ...row })) } });
        await wrapper.find('button.primary').trigger('click');
        const selection = wrapper.emitted('restore')?.[0]?.[0];
        expect(selection).toEqual([preview.files[0], preview.files[2]].map(({ path, backupHash, targetHash }) => ({ path, backupHash, targetHash })));
    });
    it('continue/retry preselect only their persisted queue and cancelled preview cannot execute', async () => {
        for (const [scope, path] of [['continue', 'a.png'], ['retry', 'b.png']] as const) {
            const wrapper = mount(RestoreTable, { props: { preview, scope } });
            await wrapper.find('button.primary').trigger('click');
            expect((wrapper.emitted('restore')?.[0]?.[0] as { path: string }[]).map(row => row.path)).toEqual([path]);
            await wrapper.setProps({ preview: { ...preview, cancelled: true } });
            expect(wrapper.find('button.primary').attributes('disabled')).toBeDefined();
            expect(wrapper.findAll('input[type=checkbox]').every(input => input.attributes('disabled') !== undefined)).toBe(true);
        }
    });
    it('save-as excludes remembered backup mode, overwrite backup is explicit, and missing paths fail before dispatch', () => {
        expect(compressionRequest({ ...config, saveMode: 'saveAs' }, 'compress')).not.toHaveProperty('backupDir');
        expect(compressionRequest(config, 'preview')).toMatchObject({ backupDir: config.backupDir });
        expect(compressionRequest(config, 'preview').options).not.toHaveProperty('version');
        expect(() => compressionRequest({ ...config, sourceDir: '' }, 'compress')).toThrow('源');
        expect(() => compressionRequest({ ...config, backupDir: '' }, 'compress')).toThrow('备份');
    });
});
