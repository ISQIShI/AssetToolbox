import { beforeEach, expect, it, vi } from 'vitest';
import { createJobCenter } from '../src/core/job-center';
import { createWorkbench } from '../src/core/workbench';
import { call } from '../src/core/api';
import { flushPromises, mount } from '@vue/test-utils';
import JobsView from '../src/views/JobsView.vue';
import { workbenchKey } from '../src/core/workbench';
vi.mock('../src/core/api', () => ({ call: vi.fn(), chooseFolder: vi.fn(), openReport: vi.fn(), openProviderSource: vi.fn() }));
const state = { done: true, phase: 'finished', processed: 2, total: 2, exitCode: 0, hasReport: true };
const row = { jobId: 'a'.repeat(64), mode: 'process', createdAt: '', state };
const emptyQueue = (maxConcurrent = 3) => ({ maxConcurrent, maxPending: 100, minConcurrent: 1, maxAllowedConcurrent: 8, availableProcessors: 12, recommendedConcurrent: 3, canConfigure: true, runningCount: 0, waitingCount: 0, slots: Array.from({ length: maxConcurrent }, (_, index) => ({ slot: index + 1, occupied: false, job: null })), waiting: [] });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(call).mockImplementation(async action => (action === 'queue' ? emptyQueue() : action === 'jobs' ? { items: [row], total: 21, nextOffset: 20 } : action === 'status' ? state : { items: [{ path: 'asset.png', status: 'processed' }], total: 1, nextOffset: null }) as any); });
it('lists durable jobs, paginates results and never takes ownership on observation or close', async () => {
    const center = createJobCenter(), bench = createWorkbench();
    await center.refresh(); await center.select(center.rows.value[0]!);
    expect(center.results.value?.items[0]?.path).toBe('asset.png');
    await center.changePage(20); expect(call).toHaveBeenCalledWith('jobs', { offset: 20, limit: 20 });
    await center.loadResults(50); expect(call).toHaveBeenCalledWith('results', { jobId: row.jobId, kind: 'files', offset: 50, limit: 50 });
    center.stop(); expect(await bench.requestClose()).toBe(true); expect(bench.job.value).toBeUndefined();
    expect(vi.mocked(call).mock.calls.some(([action]) => action === 'cancel' || action === 'submit')).toBe(false);
});
it('cancels only the explicitly selected running job and waits for authoritative completion', async () => {
    const center = createJobCenter();
    await center.select({ ...row, state: { ...state, done: false } });
    vi.mocked(call).mockImplementation(async action => (action === 'status' ? { ...state, done: false } : action === 'jobs' ? { items: [], total: 0, nextOffset: null } : {}) as any);
    await center.cancel();
    expect(call).toHaveBeenCalledWith('cancel', { jobId: row.jobId }); expect(center.selected.value?.state?.done).toBe(false);
    expect(center.cancelRequested.value).toBe(row.jobId); center.stop();
});
it('discards stale result responses after selection changes and does not query expired results', async () => {
    const center = createJobCenter(); let finish!: (value: any) => void;
    vi.mocked(call).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const pending = center.select(row);
    await center.select({ ...row, jobId: 'b'.repeat(64), state: { ...state, resultsExpired: true } });
    finish({ items: [{ path: 'wrong.png' }], total: 1, nextOffset: null }); await pending;
    expect(center.results.value).toBeUndefined(); expect(call).toHaveBeenCalledTimes(1);
});
it('preserves individual status errors without hiding other jobs', async () => {
    const center = createJobCenter(); vi.mocked(call).mockImplementation(async action => { if (action === 'status') throw Error('作业损坏'); return { items: [row], total: 1, nextOffset: null } as any; });
    await center.refresh(); expect(center.rows.value[0]?.error).toContain('作业损坏');
});
it('invalidates selected status and details when authorization or reading fails on refresh', async () => {
    const center = createJobCenter(); await center.select(row);
    vi.mocked(call).mockImplementation(async action => { if (action === 'status') throw Error('PATH_FORBIDDEN'); return { items: [], total: 0, nextOffset: null } as any; });
    await center.refresh(); await center.cancel();
    expect(center.selected.value?.state).toBeUndefined(); expect(center.results.value).toBeUndefined();
    expect(center.selected.value?.error).toContain('PATH_FORBIDDEN');
    expect(vi.mocked(call).mock.calls.some(([action]) => action === 'cancel')).toBe(false);
});
it('renders stable numbered slots, separate waiting cards and anonymous occupancy without duplicate history cards', async () => {
    const running = { ...row, state: { ...state, done: false, phase: 'processing' } };
    const waiting = { ...row, jobId: 'b'.repeat(64), state: { ...state, done: false, phase: 'queued', message: '等待可用槽位' } };
    vi.mocked(call).mockImplementation(async action => (action === 'queue' ? { ...emptyQueue(), canConfigure: false, runningCount: 2, waitingCount: 1, slots: [{ slot: 1, occupied: true, job: null }, { slot: 2, occupied: false, job: null }, { slot: 3, occupied: true, job: running }], waiting: [waiting] } : action === 'jobs' ? { items: [running, waiting], total: 2, nextOffset: null } : running.state) as any);
    const wrapper = mount(JobsView, { global: { provide: { [workbenchKey as symbol]: createWorkbench() } } });
    await flushPromises();
    expect(wrapper.findAll('.slot')).toHaveLength(3);
    expect(wrapper.find('[data-slot="1"]').text()).toContain('当前上下文无法查看');
    expect(wrapper.find('[data-slot="2"]').text()).toContain('空闲');
    expect(wrapper.find('[data-slot="3"] .job-row').text()).toContain(row.jobId);
    expect(wrapper.findAll('.job-row')).toHaveLength(2);
    expect(wrapper.find('[aria-label="并行数量"]').attributes('disabled')).toBeDefined();
    await wrapper.find('[data-slot="3"] .job-row').trigger('click');
    expect(wrapper.find('.job-detail').text()).toContain(row.jobId);
    wrapper.unmount(); expect(vi.mocked(call).mock.calls.some(([action]) => action === 'cancel')).toBe(false);
});
it('applies the recommended budget and refreshes slots only after the service accepts it', async () => {
    let budget = 2;
    vi.mocked(call).mockImplementation(async (action, payload: any) => {
        if (action === 'scheduling-set') { budget = payload.maxConcurrent; return {} as any; }
        return (action === 'queue' ? emptyQueue(budget) : { items: [], total: 0, nextOffset: null }) as any;
    });
    const wrapper = mount(JobsView, { global: { provide: { [workbenchKey as symbol]: createWorkbench() } } }); await flushPromises();
    expect(wrapper.findAll('.slot')).toHaveLength(2);
    await wrapper.findAll('button').find(button => button.text().startsWith('使用建议值'))!.trigger('click'); await flushPromises();
    expect(call).toHaveBeenCalledWith('scheduling-set', { maxConcurrent: 3 });
    expect(wrapper.findAll('.slot')).toHaveLength(3);
    await wrapper.find('[aria-label="并行数量"]').setValue(9);
    expect(wrapper.findAll('button').find(button => button.text() === '应用')!.attributes('disabled')).toBeDefined();
    wrapper.unmount();
});
it('keeps authoritative slots on a configuration race and removes stale configuration controls on query failure', async () => {
    const center = createJobCenter(); await center.refresh();
    vi.mocked(call).mockImplementation(async () => { throw Error('BUSY'); });
    await center.configure(4);
    expect(center.error.value).toContain('BUSY'); expect(center.queue.value?.maxConcurrent).toBe(3);
    await center.refresh(); expect(center.queue.value).toBeUndefined();
    vi.mocked(call).mockClear(); await center.configure(4); expect(call).not.toHaveBeenCalled();
});
