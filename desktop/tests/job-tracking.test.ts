import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import JobDock from '../src/components/JobDock.vue';
import { call } from '../src/core/api';
import type { JobState, RestoreFile } from '../src/core/types';
import { createWorkbench, workbenchKey } from '../src/core/workbench';

const { closeWindow } = vi.hoisted(() => ({ closeWindow: vi.fn() }));
vi.mock('../src/core/api', () => ({ call: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: closeWindow }) }));

const jobId = 'original-job';
const processRequest = { mode: 'process' } as const;
let bench: ReturnType<typeof createWorkbench>;
let dock: VueWrapper;
let coreState: JobState;
let disconnected: boolean;
let readResults: (payload: unknown) => unknown;

beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    coreState = { jobId, done: false, phase: 'processing', processed: 3, total: 10, current: 'sprites.png' };
    disconnected = false;
    readResults = () => { throw Error('意外的结果请求'); };
    vi.mocked(call).mockImplementation(async (action, payload) => {
        switch (action) {
            case 'submit': return { jobId };
            case 'status':
                expect(payload).toEqual({ jobId });
                if (disconnected) throw Error('桥接暂不可达');
                return structuredClone(coreState);
            case 'cancel': return { requested: true };
            case 'results': return readResults(payload);
            case 'tasks': return { items: [], nextOffset: null, total: 0 };
            default: throw Error('意外的动作 ' + action);
        }
    });
    bench = createWorkbench();
    dock = mount(JobDock, { global: { provide: { [workbenchKey as symbol]: bench } } });
});
afterEach(() => { bench.stop(); dock.unmount(); vi.useRealTimers(); });

async function nextPoll() {
    await vi.advanceTimersToNextTimerAsync();
    await flushPromises();
}
const callsFor = (action: string) => vi.mocked(call).mock.calls.filter(([name]) => name === action);

it('连续查询失败时保留作业与进度，恢复后继续跟踪到核心的真实失败', async () => {
    const finished = vi.fn();
    await bench.launch(processRequest, 'process', '处理资源', finished);
    await flushPromises();
    expect(bench.job.value?.state).toEqual(coreState);
    disconnected = true;
    await nextPoll();
    expect(bench.job.value?.state).toEqual(coreState);
    expect(bench.busy.value).toBe(true);
    expect(dock.text()).toContain('暂时无法取得作业状态');
    expect(dock.get('.count').text()).toBe('3 / 10');
    expect(dock.attributes('data-job-id')).toBe(jobId);
    bench.dismissJob();
    await bench.launch(processRequest, 'process', '另一项作业');
    expect(callsFor('submit')).toHaveLength(1);
    for (let i = 0; i < 12; i++) await nextPoll();
    expect(finished).not.toHaveBeenCalled();
    expect(bench.busy.value).toBe(true);
    disconnected = false;
    vi.mocked(call).mockResolvedValueOnce({ ...coreState, jobId: 'another-job', done: true });
    await nextPoll();
    expect(bench.job.value?.state).toEqual(coreState);
    expect(finished).not.toHaveBeenCalled();
    coreState = { ...coreState, processed: 6 };
    await nextPoll();
    expect(dock.get('.count').text()).toBe('6 / 10');
    expect(dock.text()).not.toContain('暂时无法取得作业状态');
    coreState = { ...coreState, done: true, phase: 'finished', exitCode: 1, error: '工作进程已退出' };
    await nextPoll();
    expect(bench.busy.value).toBe(false);
    expect(bench.job.value?.state).toEqual(coreState);
    expect(dock.text()).toContain('工作进程已退出');
    expect(finished).toHaveBeenCalledExactlyOnceWith(coreState);
    const finalQueries = callsFor('status').length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(callsFor('status')).toHaveLength(finalQueries);
});

it('查询中断期间请求关闭窗口，只向原作业申请取消并等到核心确认退出', async () => {
    disconnected = true;
    await bench.launch(processRequest, 'process', '处理资源');
    await flushPromises();
    vi.mocked(call).mockRejectedValueOnce(Error('取消请求未送达'));
    expect(await bench.requestClose()).toBe(false);
    expect(call).toHaveBeenCalledWith('cancel', { jobId });
    await nextPoll();
    expect(bench.job.value?.id).toBe(jobId);
    expect(bench.closing.value).toBe(true);
    expect(closeWindow).not.toHaveBeenCalled();
    disconnected = false;
    await nextPoll();
    expect(bench.job.value?.cancelRequested).toBe(true);
    expect(callsFor('cancel')).toEqual([['cancel', { jobId }], ['cancel', { jobId }]]);
    await nextPoll();
    expect(callsFor('cancel')).toHaveLength(2);
    expect(closeWindow).not.toHaveBeenCalled();
    coreState = { ...coreState, done: true, phase: 'finished', exitCode: 2, cancelled: true };
    await nextPoll();
    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(bench.job.value?.state).toEqual(coreState);
    expect(callsFor('submit')).toHaveLength(1);
});

it('恢复检查的第二页读取失败时保留核心成功终态，并隔离未读完的勾选结果', async () => {
    const file: RestoreFile = { path: 'a.png', state: 'recoverable', selectable: true, queue: 'completed', inLastSelection: false,
        backupBytes: 1, backupHash: 'a'.repeat(64), targetHash: null, reason: '目标不存在' };
    coreState = { ...coreState, done: true, phase: 'finished', exitCode: 0,
        preview: { source: '备份', destination: '目标', total: 2, checked: 2, recoverable: 2, restored: 0, conflict: 0, cancelled: false, files: [] } };
    readResults = payload => {
        if ((payload as { offset: number }).offset === 0) return { items: [file], nextOffset: 1, total: 2 };
        throw Error('第二页暂不可读');
    };
    await bench.checkRestore({ kind: 'task', taskId: 'task-1' });
    await flushPromises();
    expect(call).toHaveBeenCalledWith('results', { jobId, kind: 'restore', offset: 1, limit: 100 });
    expect(bench.job.value?.state).toMatchObject({ done: true, exitCode: 0 });
    expect(bench.restorePreview.value).toBeUndefined();
    expect(dock.text()).toContain('暂时无法读取作业结果');
    const second = { ...file, path: 'b.png', backupHash: 'b'.repeat(64) };
    const statusCount = callsFor('status').length;
    readResults = payload => (payload as { offset: number }).offset === 0
        ? { items: [file], nextOffset: 1, total: 2 }
        : { items: [second], nextOffset: null, total: 2 };
    await dock.findAll('button').find(button => button.text() === '重新读取结果')!.trigger('click');
    await flushPromises();
    expect(bench.restorePreview.value?.files).toEqual([file, second]);
    expect(bench.job.value).toBeUndefined();
    expect(callsFor('results').every(([, payload]) => (payload as { jobId: string }).jobId === jobId)).toBe(true);
    expect(callsFor('status')).toHaveLength(statusCount);
    expect(callsFor('submit')).toHaveLength(1);
});

it('音频结果暂时不可读时仍保留原终态、报告和退出能力', async () => {
    coreState = { ...coreState, done: true, phase: 'finished', exitCode: 0, hasReport: true, audioResultCount: 1 };
    readResults = () => { throw Error('音频结果暂不可读'); };
    await bench.launch(processRequest, 'process', '处理音频');
    await flushPromises();
    expect(bench.job.value?.state).toMatchObject({ done: true, exitCode: 0, hasReport: true });
    expect(bench.job.value?.state.error).toBeUndefined();
    expect(dock.text()).toContain('打开报告');
    expect(dock.text()).toContain('暂时无法读取作业结果');
    expect(await bench.requestClose()).toBe(true);
    expect(callsFor('cancel')).toHaveLength(0);
});

it('完整结果迟于新作业到达时，旧检查不能公布预览或调用新作业的完成回调', async () => {
    let releasePage!: (page: unknown) => void;
    readResults = () => new Promise(resolve => { releasePage = resolve; });
    coreState = { ...coreState, done: true, phase: 'finished', exitCode: 0,
        preview: { source: '备份', destination: '目标', total: 0, checked: 0, recoverable: 0, restored: 0, conflict: 0, cancelled: false, files: [] } };
    await bench.checkRestore({ kind: 'task', taskId: 'task-1' });
    await flushPromises();
    expect(bench.job.value?.state).toMatchObject({ done: true, exitCode: 0 });
    bench.dismissJob();
    const secondId = 'second-job';
    const running = { jobId: secondId, done: false, phase: 'processing', processed: 1, total: 8 };
    vi.mocked(call).mockResolvedValueOnce({ jobId: secondId }).mockResolvedValueOnce(running);
    const finished = vi.fn();
    await bench.launch(processRequest, 'process', '新的处理', finished);
    await flushPromises();
    releasePage({ items: [], nextOffset: null, total: 0 });
    await flushPromises();
    expect(bench.restorePreview.value).toBeUndefined();
    expect(bench.job.value?.id).toBe(secondId);
    expect(bench.job.value?.state).toEqual(running);
    expect(finished).not.toHaveBeenCalled();
    const done = { ...running, phase: 'finished', done: true, exitCode: 0 };
    vi.mocked(call).mockResolvedValueOnce(done);
    await nextPoll();
    expect(finished).toHaveBeenCalledExactlyOnceWith(done);
});

it('工作台停止跟踪后，迟到的查询异常不能再安排轮询', async () => {
    let rejectStatus!: (cause: Error) => void;
    vi.mocked(call).mockResolvedValueOnce({ jobId }).mockReturnValueOnce(new Promise((_, reject) => { rejectStatus = reject; }));
    await bench.launch(processRequest, 'process', '处理资源');
    bench.stop();
    rejectStatus(Error('退出时断连'));
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10000);
    expect(callsFor('status')).toHaveLength(1);
    expect(bench.job.value?.state.done).not.toBe(true);
    expect(closeWindow).not.toHaveBeenCalled();
});
