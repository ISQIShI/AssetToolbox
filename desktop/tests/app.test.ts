// App 级交互：作业栏、跨页取消、扫描结果归位、缺依赖拦截、任务与恢复请求。
import { config, definition, missingProvider, task } from './fixtures';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import App from '../src/App.vue';
import { call } from '../src/core/api';
import type { Definition, JobState, RestorePreview, ScanPreview } from '../src/core/types';

vi.mock('../src/core/api', () => ({ call: vi.fn(), chooseFolder: vi.fn(), openReport: vi.fn(), openProviderSource: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {}, close: vi.fn() }) }));

const scan: ScanPreview = { total: 35, checked: 35, totalBytes: 7000, enabledFiles: 35, conflicts: 0, issues: [], resources: [{ id: 'png', name: 'PNG', enabled: true, count: 35, bytes: 7000 }], cancelled: false };
const restorePreview: RestorePreview = { source: 'D:\\备份', destination: 'D:\\中文 素材', total: 2, checked: 2, recoverable: 2, restored: 0, conflict: 0, cancelled: false, files: ['a.png', 'b.png'].map(path => ({ path, state: 'recoverable', selectable: true, queue: 'completed', inLastSelection: false, backupBytes: 10, currentBytes: 5, backupHash: 'a'.repeat(64), targetHash: 'b'.repeat(64), reason: '目标仍是处理结果' })) };
let wrapper: VueWrapper, state: JobState, catalog: Definition;

const button = (text: string) => wrapper.findAll('button').find(item => item.text().trim() === text)!;
const tab = (label: string) => wrapper.findAll('nav.tabs button').find(item => item.text().startsWith(label))!;
async function go(label: string) { await tab(label).trigger('click'); await flushPromises(); }
async function finish(value: Partial<JobState>) {
    state = { ...state, done: true, phase: 'finished', exitCode: 0, ...value };
    await vi.advanceTimersByTimeAsync(250); await flushPromises();
}
async function mountApp() { wrapper = mount(App, { attachTo: document.body }); await flushPromises(); }

beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    state = { done: false, phase: 'checking', processed: 0, total: 35 };
    catalog = structuredClone(definition);
    vi.mocked(call).mockImplementation(async (action, payload) => {
        if (action === 'bootstrap') return { config: structuredClone(config), definition: catalog, warnings: [] } as any;
        if (action === 'tasks') return [task] as any;
        if (action === 'start') return { id: 'job-1' } as any;
        if (action === 'poll') return { ...state } as any;
        return payload as any;
    });
});
afterEach(() => { wrapper?.unmount(); vi.useRealTimers(); });

it('shows scan progress in the dock, then files the result under the pipeline instead of the dock', async () => {
    await mountApp();
    await button('扫描预览').trigger('click'); await flushPromises();
    expect(wrapper.find('.dock').attributes('data-state')).toBe('running');
    expect(call).toHaveBeenCalledWith('start', expect.objectContaining({ mode: 'preview', folder: config.sourceDir, backupDir: config.backupDir }));
    await finish({ processed: 35, preview: scan });
    expect(wrapper.find('.dock').exists()).toBe(false);
    expect(wrapper.find('h2').text()).toBe('扫描结果');
    await go('任务'); expect(wrapper.text()).not.toContain('扫描结果');
    await go('处理'); expect(wrapper.text()).toContain('扫描结果');
    // 扫描后修改配置，结果标为过期。
    await wrapper.findAll('.station-button')[0]!.trigger('click');
    await wrapper.find('input.path').setValue('D:\\别的文件夹');
    expect(wrapper.find('.rail').text()).toContain('配置已更改');
});

it('keeps a running job cancellable from any page and reports a cancelled scan where it belongs', async () => {
    await mountApp();
    await button('扫描预览').trigger('click'); await flushPromises(); await go('恢复');
    expect(wrapper.find('.dock').text()).toContain('扫描预览');
    await button('取消').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('cancel', { id: 'job-1' });
    expect(wrapper.find('.dock').text()).toContain('等待当前文件结束');
    await finish({ processed: 1, cancelled: true, exitCode: 2, preview: { ...scan, checked: 1, cancelled: true } });
    expect(wrapper.find('.dock').exists()).toBe(false);
    await go('处理');
    expect(wrapper.text()).toContain('扫描已取消，结果不完整');
    expect(button('扫描预览').attributes('disabled')).toBeUndefined();
});

it('keeps a finished result in the dock across pages until dismissed, without touching persisted data', async () => {
    await mountApp();
    await button('开始处理').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('save', expect.anything());
    await go('任务');
    await finish({ processed: 35, summary: { total: 35, processed: 30, skipped: 4, failed: 1, savedBytes: 2048 }, task, reportDirectory: 'D:\\r' });
    const dock = wrapper.find('.dock');
    expect(dock.attributes('data-state')).toBe('done');
    expect(dock.text()).toContain('完成，1 个失败'); expect(dock.text()).toContain('−2.0 KB');
    await go('工具'); expect(wrapper.find('.dock').exists()).toBe(true);
    const requests = vi.mocked(call).mock.calls.length;
    await wrapper.find('[aria-label="关闭作业结果"]').trigger('click');
    expect(wrapper.find('.dock').exists()).toBe(false);
    expect(vi.mocked(call).mock.calls).toHaveLength(requests);
});

it('keeps a failed preview visible with its error', async () => {
    await mountApp();
    await button('扫描预览').trigger('click'); await flushPromises();
    await finish({ exitCode: 1, error: '无法读取源文件夹' });
    expect(wrapper.find('.dock').text()).toContain('无法读取源文件夹');
    expect(wrapper.find('.dock').text()).toContain('未完成');
});

it('blocks processing while an enabled step lacks its tool, and unblocks when the step is disabled', async () => {
    catalog.providers = [missingProvider()];
    await mountApp();
    expect(tab('工具').text()).toContain('1');
    expect(button('开始处理').attributes('disabled')).toBeDefined();
    expect(wrapper.find('.runbar').text()).toContain('第 1 步的处理工具缺少依赖');
    expect(button('扫描预览').attributes('disabled')).toBeUndefined();
    await wrapper.find('[data-step-id="first"] button').trigger('click');
    expect(wrapper.text()).toContain('测试工具 缺少依赖');
    await wrapper.find('.switch input').setValue(false);
    expect(button('开始处理').attributes('disabled')).toBeUndefined();
});

it('adds a step from the catalog menu, selects it, and removes it again', async () => {
    await mountApp();
    await wrapper.find('.adder .station-button').trigger('click');
    await wrapper.findAll('.choice').find(item => item.text() === 'PNG 图片缩放')!.trigger('click');
    expect(wrapper.findAll('.rail [data-step-id]')).toHaveLength(2);
    expect(wrapper.find('.editor h2').text()).toBe('PNG 图片缩放');
    expect(wrapper.find('.editor').text()).toContain('目标宽度');
    await button('上移').trigger('click');
    expect(wrapper.find('.rail [data-step-id]').text()).toContain('PNG 图片缩放');
    await button('删除步骤').trigger('click');
    expect(wrapper.findAll('.rail [data-step-id]')).toHaveLength(1);
});

it('resumes and retries tasks by task file only', async () => {
    await mountApp(); await go('任务');
    await button('继续未完成').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('start', { mode: 'resume', taskFile: task.taskFile });
    await finish({ summary: { total: 3, processed: 3, skipped: 0, failed: 0, savedBytes: 0 } });
    await button('重试失败项').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('start', { mode: 'retry', taskFile: task.taskFile });
});

it('checks a task backup, then restores exactly the selected files with hashes', async () => {
    await mountApp(); await go('任务');
    await button('检查备份').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('start', { mode: 'restore-preview', taskFile: task.taskFile });
    await finish({ preview: restorePreview });
    expect(wrapper.find('.dock').exists()).toBe(false);
    await wrapper.find('input[aria-label="恢复 b.png"]').setValue(false);
    await button('恢复所选 1 项').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('start', { mode: 'restore', taskFile: task.taskFile, selection: [{ path: 'a.png', backupHash: 'a'.repeat(64), targetHash: 'b'.repeat(64) }] });
});

it('checks a standalone backup with both folders', async () => {
    await mountApp(); await go('恢复');
    await wrapper.findAll('.mode input')[1]!.setValue(true);
    await button('检查独立备份').trigger('click');
    expect(wrapper.text()).toContain('请选择备份文件夹和恢复目标文件夹');
    const [backup, target] = wrapper.findAll('input.path');
    await backup!.setValue('D:\\独立备份'); await target!.setValue('D:\\目标');
    await button('检查独立备份').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('start', { mode: 'restore-export-preview', backupDir: 'D:\\独立备份', outputDir: 'D:\\目标' });
});
