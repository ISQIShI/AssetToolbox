import { beforeEach, expect, it, vi } from 'vitest';
import { createJobCenter } from '../src/core/job-center';
import { createWorkbench } from '../src/core/workbench';
import { call } from '../src/core/api';
vi.mock('../src/core/api', () => ({ call: vi.fn(), chooseFolder: vi.fn(), openReport: vi.fn(), openProviderSource: vi.fn() }));
const state = { done: true, phase: 'finished', processed: 2, total: 2, exitCode: 0, hasReport: true };
const row = { jobId: 'a'.repeat(64), mode: 'process', createdAt: '', state };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(call).mockImplementation(async action => (action === 'jobs' ? { items: [row], total: 21, nextOffset: 20 } : action === 'status' ? state : { items: [{ path: 'asset.png', status: 'processed' }], total: 1, nextOffset: null }) as any); });
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
