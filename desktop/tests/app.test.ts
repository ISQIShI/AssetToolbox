import { config, definition } from './fixtures';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import App from '../src/App.vue';
import { call } from '../src/api';
import type { JobState, ScanPreview } from '../src/types';

vi.mock('../src/api', () => ({ call: vi.fn(), chooseFolder: vi.fn(), openReport: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ onCloseRequested: async () => () => {}, close: vi.fn() }) }));
const preview: ScanPreview = { total: 35, checked: 35, totalBytes: 7000, enabledFiles: 35, conflicts: 0, issues: [], resources: [], cancelled: false };
let wrapper: VueWrapper, state: JobState;
const button = (text: string) => wrapper.findAll('button').find(item => item.text().includes(text))!;
async function go(index: number) { await wrapper.findAll('nav button')[index].trigger('click'); await flushPromises(); }
async function finish(value: Partial<JobState>) {
    state = { ...state, done: true, phase: 'finished', exitCode: 0, ...value };
    await vi.advanceTimersByTimeAsync(250); await flushPromises();
}
beforeEach(async () => {
    vi.useFakeTimers(); vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    state = { done: false, phase: 'checking', processed: 0, total: 35 };
    vi.mocked(call).mockImplementation(async (action, payload) => {
        if (action === 'bootstrap') return { config: structuredClone(config), definition, warnings: [] } as any;
        if (action === 'tasks') return [] as any;
        if (action === 'start') return { id: 'job-1' } as any;
        if (action === 'poll') return { ...state } as any;
        return payload as any;
    });
    wrapper = mount(App); await flushPromises();
});
afterEach(() => { wrapper.unmount(); vi.useRealTimers(); });

it('replaces finished scan progress with the scan result only on the compression page', async () => {
    await button('扫描预览').trigger('click'); await flushPromises();
    expect(wrapper.find('.job-panel').exists()).toBe(true);
    await finish({ processed: 35, preview });
    expect(wrapper.text()).toContain('扫描结果');
    expect(wrapper.find('.job-panel').exists()).toBe(false);
    for (const index of [1, 2]) {
        await go(index);
        expect(wrapper.text()).not.toContain('扫描结果');
        expect(wrapper.find('.job-panel').exists()).toBe(false);
    }
    await go(0);
    expect(wrapper.text()).toContain('扫描结果');
    expect(wrapper.find('.job-panel').exists()).toBe(false);
});

it('keeps a running preview cancellable across pages and shows partial results only in its workspace', async () => {
    await button('扫描预览').trigger('click'); await flushPromises(); await go(2);
    expect(wrapper.find('.job-panel').text()).toContain('处理预览');
    await button('取消任务').trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('cancel', { id: 'job-1' });
    await finish({ processed: 1, cancelled: true, exitCode: 2, preview: { ...preview, checked: 1, cancelled: true } });
    expect(wrapper.find('.job-panel').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('扫描结果');
    await go(0);
    expect(wrapper.text()).toContain('扫描已取消，结果不完整');
    expect(button('扫描预览').attributes('disabled')).toBeUndefined();
});

it.each(['compression', 'preview-error'])('scopes and dismisses the completed %s card without deleting persisted data', async kind => {
    await button(kind === 'compression' ? '开始处理' : '扫描预览').trigger('click');
    await flushPromises(); await go(1);
    await finish(kind === 'compression' ? { processed: 35 } : { exitCode: 1, error: '无法读取源文件夹' });
    expect(wrapper.find('.job-panel').exists()).toBe(false);
    await go(0);
    expect(wrapper.find('.job-panel').exists()).toBe(true);
    if (kind === 'preview-error') expect(wrapper.find('.job-panel').text()).toContain('无法读取源文件夹');
    const requests = vi.mocked(call).mock.calls.length;
    await wrapper.find('[aria-label="关闭任务结果"]').trigger('click');
    expect(wrapper.find('.job-panel').exists()).toBe(false);
    expect(vi.mocked(call).mock.calls).toHaveLength(requests);
    await go(2); await go(0);
    expect(wrapper.find('.job-panel').exists()).toBe(false);
});
