import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import StepEditor from '../src/StepEditor.vue';
import { config, definition } from './fixtures';
import RestoreTable from '../src/RestoreTable.vue';
import { processingRequest, resetParameters } from '../src/model';
import type { Step, RestoreFile, RestorePreview } from '../src/types';
const file = (path: string, state: RestoreFile['state'] = 'recoverable', queue: RestoreFile['queue'] = 'pending', inLastSelection = false): RestoreFile => ({ path, state, queue, inLastSelection, selectable: state === 'recoverable', backupHash: 'a'.repeat(64), targetHash: 'b'.repeat(64), backupBytes: 100, currentBytes: state === 'conflict' ? null : 10, reason: '测试说明' });
const preview: RestorePreview = { source: 'D:\\备份', destination: 'D:\\源', total: 5, checked: 5, recoverable: 3, restored: 1, conflict: 1, cancelled: false, files: [file('a.png', 'recoverable', 'pending', true), file('b.png', 'recoverable', 'failed', true), file('c.png'), file('done.png', 'restored'), file('conflict.png', 'conflict')] };
describe('动态模块与恢复交互', () => {
    it('edits namespaced fields, changes operations and preserves enable/path choices when resetting', async () => {
        const step = config.pipeline[0];
        const wrapper = mount(StepEditor, { props: { definition, modelValue: step, index: 0, count: 1 } });
        expect(wrapper.findAll('input[type=number]')).toHaveLength(2);
        expect(wrapper.find('input[step="0.05"]').attributes('max')).toBe('1');
        await wrapper.find('[aria-label="模式"]').setValue('b');
        expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject({ providerOptions: { mode: 'b' }, parameters: {} });
        const long = '中文'.repeat(7000); await wrapper.find('[aria-label="文字"]').setValue(long);
        expect((wrapper.emitted('update:modelValue')?.at(-1)?.[0] as Step).providerOptions.text).toBe(long);
        await wrapper.setProps({ modelValue: { ...step, enabled: false } });
        expect(wrapper.findAll('input[type=number]').every(input => input.attributes('disabled') !== undefined)).toBe(true);
        expect(resetParameters({ ...config, pipeline: [{ ...step, enabled: false }] }, definition)).toMatchObject({ sourceDir: config.sourceDir, pipeline: [{ id: step.id, enabled: false, providerOptions: { level: 4, rate: .7 } }] });
        await wrapper.find('[aria-label="处理操作"]').setValue('image-resize');
        expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toMatchObject({ operation: 'image-resize', parameters: { width: 512 }, enabled: false });
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
        expect(processingRequest({ ...config, saveMode: 'saveAs' }, 'process')).not.toHaveProperty('backupDir');
        expect(processingRequest(config, 'preview')).toMatchObject({ backupDir: config.backupDir });
        expect(processingRequest(config, 'preview').pipeline).toEqual(config.pipeline);
        expect(() => processingRequest({ ...config, sourceDir: '' }, 'process')).toThrow('源');
        expect(() => processingRequest({ ...config, backupDir: '' }, 'process')).toThrow('备份');
    });
});
