// 只观察公共作业；不接管提交会话，也不参与窗口关闭时的取消。
import { ref } from 'vue';
import { call } from './api';
import type { JobState, ResultPage } from './types';
export interface JobRow { jobId: string; mode: string; createdAt: string; state?: JobState; error?: string }
export interface QueueSnapshot { maxConcurrent: number; maxPending: number; minConcurrent: number; maxAllowedConcurrent: number; availableProcessors: number; recommendedConcurrent: number; canConfigure: boolean; runningCount: number; waitingCount: number; slots: { slot: number; occupied: boolean; job: JobRow | null }[]; waiting: JobRow[] }
export const jobModes: Record<string, string> = { process: '处理资源', preview: '扫描预览', resume: '续跑', retry: '重试', restore: '恢复', 'restore-preview': '检查备份', 'restore-retry': '重试恢复', 'restore-export': '导出备份', 'restore-export-preview': '检查独立备份', 'dependency-install': '安装依赖' };
export function jobLabel(state?: JobState) { return !state ? '无法读取' : !state.done ? (state.phase === 'queued' ? '排队中' : '运行中') : state.cancelled ? '已取消' : state.exitCode || state.error ? '失败 / 中断' : state.resultsExpired ? '明细已清理' : '已完成'; }
export function createJobCenter() {
    const rows = ref<JobRow[]>([]), offset = ref(0), total = ref(0), next = ref<number | null>(null);
    const selected = ref<JobRow>(), results = ref<ResultPage<Record<string, unknown>>>(), resultOffset = ref(0);
    const error = ref(''), loading = ref(false), cancelling = ref(false), cancelRequested = ref('');
    const queue = ref<QueueSnapshot>(), saving = ref(false);
    let revision = 0, selection = 0, timer: ReturnType<typeof setTimeout> | undefined, active = false;
    async function refresh() {
        if (loading.value) return;
        const version = revision; loading.value = true; error.value = '';
        try {
            const [list, snapshot] = await Promise.all([
                call<ResultPage<JobRow>>('jobs', { offset: offset.value, limit: 20 }),
                call<QueueSnapshot>('queue').catch(cause => { if (version === revision) { queue.value = undefined; error.value = String(cause); } return undefined; }),
            ]);
            const items = await Promise.all(list.items.map(async row => {
                try { return { ...row, state: await call<JobState>('status', { jobId: row.jobId }) }; }
                catch (cause) { return { ...row, error: String(cause) }; }
            }));
            if (version !== revision) return;
            queue.value = snapshot;
            rows.value = items; total.value = list.total; next.value = list.nextOffset;
            if (selected.value) {
                const current = selected.value;
                let state: JobState;
                try { state = await call<JobState>('status', { jobId: current.jobId }); }
                catch (cause) {
                    if (version === revision && selected.value?.jobId === current.jobId) {
                        selected.value = { ...current, state: undefined, error: String(cause) };
                        selection++; results.value = undefined;
                    }
                    return;
                }
                if (version !== revision || selected.value?.jobId !== current.jobId) return;
                selected.value = { ...current, state, error: undefined };
                if (state.resultsExpired) { selection++; results.value = undefined; }
                else if (state.done && !current.state?.done) await loadResults(0);
            }
        } catch (cause) { if (version === revision) { queue.value = undefined; error.value = String(cause); } }
        finally { loading.value = false; }
    }
    async function loadResults(start = 0) {
        const row = selected.value, token = ++selection; results.value = undefined; resultOffset.value = start;
        if (!row?.state?.done || row.state.resultsExpired) return;
        const kind = row.mode.includes('restore') && row.mode.includes('preview') ? 'restore' : 'files';
        if (kind === 'files' && !row.state.hasReport) return;
        try {
            const value = await call<ResultPage<Record<string, unknown>>>('results', { jobId: row.jobId, kind, offset: start, limit: 50 });
            if (token === selection && selected.value?.jobId === row.jobId) results.value = value;
        } catch (cause) { if (token === selection) error.value = String(cause); }
    }
    async function select(row: JobRow) { selected.value = row; error.value = ''; await loadResults(); }
    async function changePage(start: number) { if (loading.value) return; offset.value = start; await refresh(); }
    async function cancel() {
        const row = selected.value;
        if (!row?.state || row.state.done || cancelling.value) return;
        cancelling.value = true; error.value = '';
        try { await call('cancel', { jobId: row.jobId }); cancelRequested.value = row.jobId; await refresh(); }
        catch (cause) { error.value = String(cause); }
        finally { cancelling.value = false; }
    }
    async function tick() { await refresh(); if (active) timer = setTimeout(() => void tick(), 2000); }
    async function configure(maxConcurrent: number) {
        if (!queue.value?.canConfigure || saving.value) return;
        saving.value = true; error.value = '';
        try { await call('scheduling-set', { maxConcurrent }); await refresh(); }
        catch (cause) { error.value = String(cause); }
        finally { saving.value = false; }
    }
    function start() { if (active) return; active = true; void tick(); }
    function stop() { active = false; revision++; selection++; clearTimeout(timer); }
    return { rows, offset, total, next, selected, results, resultOffset, error, loading, cancelling, cancelRequested, queue, saving, configure, refresh, select, changePage, loadResults, cancel, start, stop };
}
