// App 级交互：作业栏、跨页取消、扫描结果归位、缺依赖拦截、任务与恢复请求、快捷键与外观。
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
// 确认对话框由 Reka UI 挂到 body 上，不在 wrapper 内。
const dialog = () => document.body.querySelector<HTMLElement>('.dialog');
async function answer(accept: boolean) {
    await flushPromises();
    const target = accept ? dialog()!.querySelector<HTMLElement>('[data-confirm]')! : Array.from(dialog()!.querySelectorAll<HTMLElement>('button')).find(item => item.textContent?.trim() === '取消')!;
    target.click(); await flushPromises();
}
async function mountApp() { wrapper = mount(App, { attachTo: document.body }); await flushPromises(); }

beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    state = { done: false, phase: 'checking', processed: 0, total: 35 };
    catalog = structuredClone(definition);
    vi.mocked(call).mockImplementation(async (action, payload) => {
        if (action === 'bootstrap') return { config: structuredClone(config), definition: catalog, warnings: [] } as any;
        if (action === 'tasks') return { items: [task], total: 1, nextOffset: null } as any;
        if (action === 'providers') return structuredClone(catalog.providers) as any;
        if (action === 'submit') return { jobId: 'job-1', replayed: false } as any;
        if (action === 'status') return { ...state, preview: state.preview ? { ...state.preview, files: undefined } : undefined } as any;
        if (action === 'results') return { items: restorePreview.files, total: restorePreview.files.length, nextOffset: null } as any;
        return payload as any;
    });
});
afterEach(() => { wrapper?.unmount(); vi.useRealTimers(); });

it('shows scan progress in the dock, then files the result under the pipeline instead of the dock', async () => {
    await mountApp();
    await button('扫描预览').trigger('click'); await flushPromises();
    expect(wrapper.find('.dock').attributes('data-state')).toBe('running');
    expect(call).toHaveBeenCalledWith('submit', { request: expect.objectContaining({ mode: 'preview', folder: config.sourceDir, backupDir: config.backupDir }), idempotencyKey: expect.any(String) });
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
    expect(call).toHaveBeenCalledWith('cancel', { jobId: 'job-1' });
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
    await finish({ processed: 35, summary: { total: 35, processed: 30, skipped: 4, failed: 1, savedBytes: 2048 }, task, hasReport: true });
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
    expect(wrapper.findAll('.choice').map(item => item.attributes('aria-label'))).toEqual(['图片']);
    await wrapper.find('.choice[aria-label="图片"]').trigger('click');
    await wrapper.find('.choice[aria-label="PNG"]').trigger('click');
    await wrapper.find('.choice[aria-label="图片缩放"]').trigger('click');
    expect(wrapper.find('.step-picker').exists()).toBe(false);
    expect(wrapper.findAll('.rail [data-step-id]')).toHaveLength(2);
    expect(wrapper.find('.editor h2').text()).toBe('PNG 图片缩放');
    expect(wrapper.find('.editor').text()).toContain('目标宽度');
    expect(wrapper.find('input[type="number"]').element).toHaveProperty('value', '512');
    await button('上移').trigger('click');
    expect(wrapper.find('.rail [data-step-id]').text()).toContain('PNG 图片缩放');
    // 删除先确认：取消保留步骤，确认后才删除。
    await button('删除步骤').trigger('click'); await flushPromises();
    expect(dialog()!.textContent).toContain('第 1 步“PNG 图片缩放”');
    await answer(false);
    expect(dialog()).toBeNull(); expect(wrapper.findAll('.rail [data-step-id]')).toHaveLength(2);
    await button('删除步骤').trigger('click'); await answer(true);
    expect(wrapper.findAll('.rail [data-step-id]')).toHaveLength(1);
    expect(wrapper.find('.rail [data-step-id]').text()).not.toContain('PNG 图片缩放');
});

it('resumes and retries tasks by task file only', async () => {
    await mountApp(); await go('任务');
    await button('继续未完成').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('submit', { request: { mode: 'resume', taskId: task.id }, idempotencyKey: expect.any(String) });
    await finish({ summary: { total: 3, processed: 3, skipped: 0, failed: 0, savedBytes: 0 } });
    await button('重试失败项').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('submit', { request: { mode: 'retry', taskId: task.id }, idempotencyKey: expect.any(String) });
});

it('keeps the write policy visible and links it to its settings without changing the configuration', async () => {
    await mountApp();
    const summary = () => wrapper.find('.summary-link');
    expect(summary().text()).toBe('覆盖原文件，替换前备份');
    await summary().trigger('click');
    expect(wrapper.find('h2').text()).toBe('写入方式');
    await wrapper.find('.check input').setValue(false);
    expect(summary().text()).toBe('覆盖原文件，不保留备份');
    expect(summary().classes()).toContain('warn');
    await wrapper.find('input[value="saveAs"]').setValue(true);
    expect(summary().text()).toBe('另存结果，保留原文件');
    expect(call).not.toHaveBeenCalledWith('save', expect.anything());
    expect(call).not.toHaveBeenCalledWith('submit', expect.anything());
});

it('returns keyboard focus to the add-step button when Escape dismisses its choices', async () => {
    await mountApp();
    const add = wrapper.find('.adder .station-button');
    await add.trigger('click');
    const choice = wrapper.find('.choice');
    (choice.element as HTMLButtonElement).focus();
    await choice.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.step-picker').exists()).toBe(false);
    expect(document.activeElement).toBe(add.element);
    expect(add.attributes('aria-expanded')).toBe('false');
});

it('chooses category then format then operation, supports search and back without creating partial steps', async () => {
    await mountApp();
    const add = wrapper.find('.adder .station-button');
    await add.trigger('click');
    const search = wrapper.find('input[aria-label="搜索资源分组"]');
    expect(document.activeElement).toBe(search.element);
    await search.setValue('图片'); expect(wrapper.findAll('.choice')).toHaveLength(1);
    await search.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(wrapper.find('.choice').element);
    await wrapper.find('.choice').trigger('click');
    const formats = wrapper.find('input[aria-label="搜索资源格式"]');
    expect(document.activeElement).toBe(formats.element);
    await formats.setValue('jpg'); expect(wrapper.findAll('.choice')).toHaveLength(0);
    expect(wrapper.find('[role="status"]').text()).toContain('没有匹配项');
    await formats.setValue('.png'); await wrapper.find('.choice').trigger('click');
    expect(wrapper.find('.picker-path').text()).toBe('资源分组 / 图片 / PNG');
    expect(wrapper.findAll('.choice').map(item => item.text())).toEqual(expect.arrayContaining([expect.stringContaining('压缩'), expect.stringContaining('图片缩放')]));
    expect(wrapper.findAll('.rail [data-step-id]')).toHaveLength(1);
    await wrapper.find('input[aria-label="搜索操作"]').setValue('缩放'); expect(wrapper.findAll('.choice')).toHaveLength(1);
    (wrapper.find('.choice').element as HTMLButtonElement).focus();
    await wrapper.find('.choice').trigger('keydown', { key: 'ArrowLeft' });
    expect(wrapper.find('input[aria-label="搜索资源格式"]').exists()).toBe(true);
    await wrapper.find('[aria-label="返回上一级"]').trigger('click');
    expect(wrapper.find('input[aria-label="搜索资源分组"]').exists()).toBe(true);
    await wrapper.find('.step-picker').trigger('keydown', { key: 'Escape' });
    expect(document.activeElement).toBe(add.element);
    expect(wrapper.findAll('.rail [data-step-id]')).toHaveLength(1);
    await add.trigger('click'); expect(wrapper.find('input[aria-label="搜索资源分组"]').element).toHaveProperty('value', '');
});

it('dismisses the picker when focus leaves, the user clicks outside, the window resizes or a job starts', async () => {
    await mountApp();
    const add = wrapper.find('.adder .station-button');
    await add.trigger('click');
    (button('扫描预览').element as HTMLButtonElement).focus();
    await flushPromises();
    expect(wrapper.find('.step-picker').exists()).toBe(false);
    await add.trigger('click');
    await wrapper.find('.runbar').trigger('pointerdown');
    expect(wrapper.find('.step-picker').exists()).toBe(false);
    await add.trigger('click');
    window.dispatchEvent(new Event('resize')); await flushPromises();
    expect(wrapper.find('.step-picker').exists()).toBe(false);
    await add.trigger('click');
    await button('扫描预览').trigger('click'); await flushPromises();
    expect(wrapper.find('.step-picker').exists()).toBe(false);
    expect(add.attributes('disabled')).toBeDefined();
});

it('allows configuring a missing tool while preserving the execution guard', async () => {
    catalog.providers = [missingProvider()];
    await mountApp();
    await wrapper.find('.adder .station-button').trigger('click');
    await wrapper.find('.choice[aria-label="图片"]').trigger('click');
    await wrapper.find('.choice[aria-label="PNG"]').trigger('click');
    await wrapper.find('.choice[aria-label="图片缩放"]').trigger('click');
    expect(wrapper.findAll('.rail [data-step-id]')).toHaveLength(2);
    expect(wrapper.find('.editor').text()).toContain('缺少依赖');
    expect(button('开始处理').attributes('disabled')).toBeDefined();
});

it('checks a task backup, then restores exactly the selected files with hashes', async () => {
    await mountApp(); await go('任务');
    await button('检查备份').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('submit', { request: { mode: 'restore-preview', taskId: task.id }, idempotencyKey: expect.any(String) });
    await finish({ preview: restorePreview });
    expect(wrapper.find('.dock').exists()).toBe(false);
    await wrapper.find('input[aria-label="恢复 b.png"]').setValue(false);
    await button('恢复所选 1 项').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('submit', { request: { mode: 'restore', taskId: task.id, selection: [{ path: 'a.png', backupHash: 'a'.repeat(64), targetHash: 'b'.repeat(64) }] }, idempotencyKey: expect.any(String) });
});

it('checks a standalone backup with both folders', async () => {
    await mountApp(); await go('恢复');
    await wrapper.findAll('.mode input')[1]!.setValue(true);
    await button('检查独立备份').trigger('click');
    expect(wrapper.text()).toContain('请选择备份文件夹和恢复目标文件夹');
    const [backup, target] = wrapper.findAll('input.path');
    await backup!.setValue('D:\\独立备份'); await target!.setValue('D:\\目标');
    await button('检查独立备份').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('submit', { request: { mode: 'restore-export-preview', backupDir: 'D:\\独立备份', outputDir: 'D:\\目标' }, idempotencyKey: expect.any(String) });
});

it('installs a missing dependency by ID, locks concurrent work and refreshes availability without losing edits', async () => {
    catalog.providers = [{ ...missingProvider(), dependency: { automatic: true, state: 'missing', action: 'install', targetVersion: '4.0', sources: ['www.rarewares.org'], reason: '核验版本' } }];
    await mountApp();
    await wrapper.find('input.path').setValue('D:\\正在编辑');
    await go('工具');
    await button('获取并安装').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('submit', { request: { mode: 'dependency-install', providerId: 'test' }, idempotencyKey: expect.any(String) });
    expect(button('获取并安装').attributes('disabled')).toBeDefined();
    expect(button('刷新依赖状态').attributes('disabled')).toBeDefined();
    catalog.providers = [{ ...catalog.providers[0]!, availability: { available: true, reason: '' }, dependency: { automatic: true, state: 'current', action: 'reinstall', installedVersion: '4.0', targetVersion: '4.0', reason: '核验版本' } }];
    await finish({ message: '依赖已安装', processed: 1, total: 1 });
    expect(call).toHaveBeenCalledWith('providers');
    expect(wrapper.text()).toContain('已安装核验版本');
    expect(button('重新安装').attributes('disabled')).toBeUndefined();
    await go('处理'); expect((wrapper.find('input.path').element as HTMLInputElement).value).toBe('D:\\正在编辑');
});

it('offers updates only for managed plans and keeps cancellation/errors visible', async () => {
    catalog.providers = [{ ...definition.providers[0]!, dependency: { automatic: true, state: 'update', action: 'update', installedVersion: '3.1', targetVersion: '4.0', reason: '核验版本' } }];
    await mountApp(); await go('工具');
    expect(wrapper.text()).toContain('有新的核验版本');
    await button('更新到核验版本').trigger('click'); await flushPromises();
    await button('取消').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('cancel', { jobId: 'job-1' });
    expect(wrapper.find('.dock').text()).toContain('等待依赖检查结束');
    await finish({ cancelled: true, exitCode: 2, message: '安装已取消，原安装保持不变。' });
    expect(wrapper.find('.dock').text()).toContain('原安装保持不变');
    state = { done: false, phase: 'downloading', processed: 0, total: 1 };
    await button('更新到核验版本').trigger('click'); await flushPromises();
    await finish({ cancelled: false, exitCode: 1, error: '下载完整性校验失败' });
    expect(wrapper.find('.dock').text()).toContain('下载完整性校验失败');
    expect(wrapper.text()).toContain('当前：3.1');
});

it('switches workspaces and saves with keyboard shortcuts, and reports health in the status bar', async () => {
    await mountApp();
    const press = async (key: string) => { window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true })); await flushPromises(); };
    expect(wrapper.find('.statusbar').text()).toContain('就绪');
    expect(wrapper.find('.statusbar').text()).toContain('1 个任务可继续');
    expect(wrapper.find('.statusbar').text()).toContain('处理工具 1 / 1 可用');
    await press('2');
    expect(tab('任务').attributes('aria-current')).toBe('page');
    await press('s');
    expect(call).not.toHaveBeenCalledWith('save', expect.anything());
    await press('1'); await press('s');
    expect(call).toHaveBeenCalledWith('save', expect.objectContaining({ sourceDir: config.sourceDir }));
    await button('扫描预览').trigger('click'); await flushPromises();
    expect(wrapper.find('.statusbar').text()).toContain('正在运行：扫描预览');
});

it('switches appearance with a single click each way and returns to following the system', async () => {
    await mountApp();
    const toggle = wrapper.find('.tab.theme');
    expect(toggle.attributes('aria-label')).toBe('外观：浅色（跟随系统）');
    await toggle.trigger('click');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(toggle.attributes('aria-label')).toBe('外观：深色');
    await toggle.trigger('click');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(toggle.attributes('aria-label')).toBe('外观：浅色（跟随系统）');
});

it('asks before overwriting without backup and starts only after confirmation', async () => {
    await mountApp();
    await wrapper.find('[data-station="output"]').trigger('click');
    await wrapper.find('.check input').setValue(false);
    await button('开始处理').trigger('click'); await flushPromises();
    expect(dialog()!.textContent).toContain('没有启用备份');
    await answer(false);
    expect(call).not.toHaveBeenCalledWith('submit', expect.anything());
    expect(call).not.toHaveBeenCalledWith('save', expect.anything());
    await button('开始处理').trigger('click'); await answer(true);
    expect(call).toHaveBeenCalledWith('submit', expect.objectContaining({ request: expect.objectContaining({ mode: 'process' }) }));
    expect(wrapper.find('.dock').exists()).toBe(true);
});

it('reorders steps from the keyboard and by position, and toggles a step without selecting another', async () => {
    await mountApp();
    await wrapper.find('.adder .station-button').trigger('click');
    await wrapper.find('.choice[aria-label="图片"]').trigger('click');
    await wrapper.find('.choice[aria-label="PNG"]').trigger('click');
    await wrapper.find('.choice[aria-label="图片缩放"]').trigger('click');
    const order = () => wrapper.findAll('.rail [data-step-id]').map(item => item.text().includes('图片缩放') ? 'resize' : 'compress');
    expect(order()).toEqual(['compress', 'resize']);
    const second = wrapper.findAll('.rail [data-step-id] .station-button')[1]!;
    await second.trigger('keydown', { key: 'ArrowUp', altKey: true });
    expect(order()).toEqual(['resize', 'compress']);
    await wrapper.findAll('.rail [data-step-id] .station-button')[0]!.trigger('keydown', { key: 'ArrowUp', altKey: true });
    expect(order()).toEqual(['resize', 'compress']);
    await wrapper.findAll('.rail [data-step-id] .station-button')[0]!.trigger('keydown', { key: 'ArrowDown' });
    expect(order()).toEqual(['resize', 'compress']);
    expect(wrapper.find('.editor h2').text()).toBe('PNG 图片缩放');
});
