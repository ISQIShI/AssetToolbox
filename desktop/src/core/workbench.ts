// 工作台状态：一个 App 实例创建一份，通过 provide/inject 交给视图。
// 所有对核心的调用、作业生命周期（启动、轮询、取消、安全退出）都集中在这里。
import { computed, inject, reactive, ref, watch, type InjectionKey } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { call, chooseFolder, isDirectory, openFolder, openProviderSource, openReport } from './api';
import { bytes, createStep, isMissing, processingRequest, providerOf, stepTitle } from './model';
import type { StoragePreview, StorageResult, StorageSelection } from './types';
import type { Bootstrap, Configuration, Definition, JobRequest, JobState, Provider, ResultPage, RestoreFile, AudioResult, RestorePreview, RestoreScope, ScanPreview, Selection, Step, Task } from './types';

export type Page = 'process' | 'tasks' | 'restore' | 'tools' | 'jobs';
export type JobKind = 'preview' | 'process' | 'resume' | 'retry' | 'restore-check' | 'restore' | 'dependency';
export interface ActiveJob {
    id: string; kind: JobKind; title: string; state: JobState; cancelRequested: boolean;
    statusError?: string; resultError?: string; readingResults?: boolean;
    onFinished?: (state: JobState) => void;
}
export type RestoreSource = { kind: 'task'; taskId: string } | { kind: 'export'; backupDir: string; outputDir: string };

export interface ConfirmRequest { title: string; message: string; confirmLabel: string; danger?: boolean }

const POLL_MS = 250;
const MAX_RETRY_MS = 4000;

export function createWorkbench() {
    const page = ref<Page>('process');
    const boot = ref<Bootstrap>();
    const config = ref<Configuration>();
    const tasks = ref<Task[]>([]);
    const loading = ref(true);
    const error = ref('');
    const notice = ref('');
    const maintenanceBusy = ref(false);
    const storagePreview = ref<StoragePreview>();

    // 处理页：当前选中的处理线站点（source / output / step:<步骤 ID>）与最近一次扫描；扫描结果显示在概览栏。
    const station = ref('source');
    const scan = ref<ScanPreview>();
    const scanRequest = ref('');

    // 任务页与恢复页。
    const selectedTaskId = ref<string>();
    const restoreForm = reactive({ kind: 'task' as RestoreSource['kind'], taskId: '', backupDir: '', outputDir: '' });
    const restoreSource = computed<RestoreSource | undefined>(() => {
        if (restoreForm.kind === 'task') return restoreForm.taskId ? { kind: 'task', taskId: restoreForm.taskId } : undefined;
        const backupDir = restoreForm.backupDir.trim(), outputDir = restoreForm.outputDir.trim();
        return backupDir && outputDir ? { kind: 'export', backupDir, outputDir } : undefined;
    });
    const restorePreview = ref<RestorePreview>();
    const restoreScope = ref<RestoreScope>('all');
    const restoreChoices = ref(new Map<string, boolean>());
    watch(restoreSource, () => {
        restorePreview.value = undefined;
        restoreScope.value = 'all';
        restoreChoices.value = new Map();
    }, { flush: 'sync' });

    // 作业：同一时间最多一个；submitting 覆盖 submit 请求尚未返回的窗口。
    const job = ref<ActiveJob>();
    const submitting = ref(false);
    const closing = ref(false);
    let pendingCancel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const definition = computed<Definition | undefined>(() => boot.value?.definition || undefined);
    const busy = computed(() => maintenanceBusy.value || submitting.value || Boolean(job.value && !job.value.state.done));
    const missingProviders = computed(() => definition.value?.providers.filter(isMissing) || []);
    const blockedSteps = computed(() => {
        if (!config.value || !definition.value) return [];
        return config.value.pipeline.map((step, index) => ({ step, index })).filter(({ step }) => step.enabled && isMissing(providerOf(definition.value!, step)));
    });
    const scanStale = computed(() => {
        if (!scan.value || !config.value) return false;
        try { return JSON.stringify(processingRequest(config.value, 'preview', definition.value)) !== scanRequest.value; } catch { return true; }
    });

    const messageOf = (cause: unknown) => String(cause instanceof Error ? cause.message : cause);
    const fail = (cause: unknown) => { error.value = messageOf(cause); };

    async function allPages<T>(action: string, input = {}): Promise<T[]> {
        const items: T[] = []; let offset: number | null = 0;
        do { const page: ResultPage<T> = await call(action, { ...input, offset, limit: 100 }); items.push(...page.items); offset = page.nextOffset; } while (offset !== null);
        return items;
    }
    async function refreshTasks() { tasks.value = await allPages<Task>('tasks'); }
    async function previewStorage(retentionDays: number, offset = 0) {
        if (busy.value) return;
        maintenanceBusy.value = true; error.value = ''; storagePreview.value = undefined;
        try { storagePreview.value = await call<StoragePreview>('storage-preview', { retentionDays, offset, limit: 100 }); }
        catch (cause) { fail(cause); }
        finally { maintenanceBusy.value = false; if (closing.value) await getCurrentWindow().close(); }
    }
    async function cleanStorage(selection: StorageSelection[]) {
        if (busy.value || !storagePreview.value || !selection.length) return;
        const retentionDays = storagePreview.value.retentionDays;
        maintenanceBusy.value = true; error.value = ''; notice.value = '';
        try {
            const result = await call<StorageResult>('storage-clean', { retentionDays, selection });
            notice.value = `已清理 ${result.cleaned} 个作业的旧明细，释放 ${bytes(result.freedBytes)}。任务、备份和幂等记录保留。`;
            if (result.failed) fail(result.items.filter(item => !item.cleaned).map(item => item.error).join('；'));
            if (job.value && selection.some(item => item.jobId === job.value!.id)) job.value.state = await call<JobState>('status', { jobId: job.value.id });
            storagePreview.value = await call<StoragePreview>('storage-preview', { retentionDays, offset: 0, limit: 100 });
        } catch (cause) { storagePreview.value = undefined; fail(cause); }
        finally { maintenanceBusy.value = false; if (closing.value) await getCurrentWindow().close(); }
    }
    async function refreshProviders() {
        try {
            const providers = await call<Provider[]>('providers');
            if (boot.value?.definition) boot.value.definition.providers = providers;
        } catch (cause) { fail(cause); }
    }
    async function initialize() {
        try {
            const result = await call<Bootstrap>('bootstrap');
            // 先复制原始响应再放入响应式状态；对代理对象调用 structuredClone 会抛错。
            if (result.config) config.value = structuredClone(result.config);
            boot.value = result;
            await refreshTasks();
        } catch (cause) { fail(cause); } finally { loading.value = false; }
    }

    async function browse(title: string, current?: string): Promise<string | undefined> {
        try { return (await chooseFolder(title, current || undefined)) || undefined; } catch (cause) { fail(cause); return undefined; }
    }

    async function saveConfig() {
        if (!config.value) return;
        error.value = ''; notice.value = '';
        try { config.value = await call<Configuration>('save', config.value); notice.value = '配置已保存，下次打开时自动恢复。'; } catch (cause) { fail(cause); }
    }

    // ---------- 作业生命周期 ----------
    // 终态与结果明细分开读取。整页恢复清单到齐后才交给恢复表单。
    async function readJobResults() {
        const active = job.value;
        if (stopped || !active?.state.done || active.readingResults) return;
        active.readingResults = true;
        let state = active.state;
        try {
            if (state.preview && active.kind === 'restore-check') {
                const files = await allPages<RestoreFile>('results', { jobId: active.id, kind: 'restore' });
                state = { ...state, preview: { ...state.preview as RestorePreview, files } };
            }
            if (state.hasReport && state.audioResultCount && !state.resultsExpired) {
                const page = await call<ResultPage<AudioResult>>('results', { jobId: active.id, kind: 'audio', limit: 100 });
                state = { ...state, audioResults: page.items };
            }
        } catch (cause) {
            if (!stopped && job.value === active) active.resultError = messageOf(cause) || '读取失败';
            return;
        } finally {
            active.readingResults = false;
        }
        if (stopped || job.value !== active) return;
        active.resultError = undefined;
        active.state = state;
        const finished = active.onFinished;
        active.onFinished = undefined;
        finished?.(state);
        if (state.preview && (active.kind === 'preview' || active.kind === 'restore-check')) job.value = undefined;
    }

    async function poll(active: ActiveJob, retryMs = POLL_MS * 2) {
        if (stopped || job.value !== active) return;
        let state: JobState;
        try {
            state = await call<JobState>('status', { jobId: active.id });
            if (typeof state?.done !== 'boolean' || (state.jobId !== undefined && state.jobId !== active.id)) throw Error('核心返回的作业状态无效');
        } catch (cause) {
            if (stopped || job.value !== active) return;
            active.statusError = messageOf(cause) || '查询失败';
            timer = setTimeout(() => void poll(active, Math.min(retryMs * 2, MAX_RETRY_MS)), retryMs);
            return;
        }
        if (stopped || job.value !== active) return;
        active.statusError = undefined;
        active.state = state;
        if (!state.done) {
            if (closing.value && !active.cancelRequested) void requestCancellation(active);
            timer = setTimeout(() => void poll(active), POLL_MS);
            return;
        }
        if (closing.value) {
            try { await getCurrentWindow().close(); return; }
            catch (cause) { closing.value = false; fail(cause); }
        }
        await readJobResults();
        if (stopped) return;
        if (active.kind === 'dependency') await refreshProviders();
        try { await refreshTasks(); } catch (cause) { fail(cause); }
    }

    async function launch(request: JobRequest, kind: JobKind, title: string, finished?: (state: JobState) => void) {
        if (busy.value) return;
        error.value = ''; pendingCancel = false; submitting.value = true;
        try {
            const { jobId: id } = await call<{ jobId: string }>('submit', { request, idempotencyKey: crypto.randomUUID() });
            job.value = { id, kind, title, cancelRequested: false, onFinished: finished, state: { phase: 'starting', done: false, processed: 0, total: 0 } };
            const active = job.value;
            if (pendingCancel || closing.value) await requestCancellation(active);
            void poll(active);
        } catch (cause) { fail(cause); } finally { submitting.value = false; }
    }

    async function requestCancellation(active: ActiveJob) {
        if (active.cancelRequested || active.state.done) return;
        active.cancelRequested = true;
        try { await call('cancel', { jobId: active.id }); }
        catch (cause) {
            if (!stopped && job.value === active && !active.state.done) { active.cancelRequested = false; fail(cause); }
        }
    }
    async function cancelJob() {
        if (submitting.value) { pendingCancel = true; return; }
        if (job.value) await requestCancellation(job.value);
    }

    function dismissJob() { if (job.value?.state.done) job.value = undefined; }

    async function openJobReport() { if (job.value) try { await openReport(job.value.id); } catch (cause) { fail(cause); } }

    /** 窗口关闭：有作业时先协作取消，等桥接确认结束后由 poll 关闭窗口。 */
    async function requestClose(): Promise<boolean> {
        if (maintenanceBusy.value) { closing.value = true; return false; }
        if (!busy.value) return true;
        closing.value = true; await cancelJob(); return false;
    }

    // ---------- 处理页 ----------
    async function runPipeline(mode: 'preview' | 'process') {
        if (!config.value || busy.value) return;
        error.value = ''; notice.value = '';
        try {
            const normalized = await call<Configuration>('normalize', config.value);
            const request = processingRequest(normalized, mode, definition.value);
            if (mode === 'process') {
                try { await call('save', normalized); } catch (cause) { notice.value = `配置未能保存，本次仍按当前设置处理：${cause instanceof Error ? cause.message : cause}`; }
                await launch(request, 'process', '处理资源');
                return;
            }
            const snapshot = JSON.stringify(processingRequest(config.value, 'preview', definition.value));
            await launch(request, 'preview', '扫描预览', state => {
                if (!state.preview) return;
                scan.value = state.preview as ScanPreview; scanRequest.value = snapshot;
            });
        } catch (cause) { fail(cause); }
    }

    /** 把拖入窗口的文件夹设为来源；拖入的若不是文件夹则拒绝并说明。 */
    async function useDroppedSource(paths: string[]) {
        const folder = paths[0];
        if (!config.value || busy.value || !folder) return;
        try {
            if (!(await isDirectory(folder))) { fail('请拖入文件夹；单个文件不能作为来源。'); return; }
            error.value = ''; config.value.sourceDir = folder; station.value = 'source';
        } catch (cause) { fail(cause); }
    }

    function addStep(resourceType: string, operation: string) {
        if (!config.value || !definition.value || config.value.pipeline.length >= 64) return;
        try {
            const step = createStep(definition.value, resourceType, operation);
            if (definition.value.operations.find(item => item.id === operation)?.preserveOriginal) config.value.saveMode = 'saveAs';
            config.value.pipeline.push(step); station.value = `step:${step.id}`;
        } catch (cause) { fail(cause); }
    }
    function moveStep(index: number, offset: number) {
        const pipeline = config.value?.pipeline;
        if (!pipeline || index + offset < 0 || index + offset >= pipeline.length) return;
        const [step] = pipeline.splice(index, 1); pipeline.splice(index + offset, 0, step!);
    }
    function updateStep(index: number, step: Step) {
        const previous = config.value?.pipeline[index];
        if (!previous || !config.value) return;
        if (step.enabled && (previous.operation !== step.operation || !previous.enabled)
            && definition.value?.operations.find(item => item.id === step.operation)?.preserveOriginal) config.value.saveMode = 'saveAs';
        config.value.pipeline[index] = step;
    }
    /** 把步骤移到指定位置（拖拽排序用）；选中项不变。 */
    function moveStepTo(from: number, to: number) {
        const pipeline = config.value?.pipeline;
        if (!pipeline || from === to || !pipeline[from] || to < 0 || to >= pipeline.length) return;
        const [step] = pipeline.splice(from, 1); pipeline.splice(to, 0, step!);
    }
    function toggleStep(index: number) {
        const step = config.value?.pipeline[index];
        if (step) updateStep(index, { ...step, enabled: !step.enabled });
    }

    // ---------- 确认对话框：同一时间最多一个，由 App 中的 ConfirmDialog 显示 ----------
    const confirmation = ref<ConfirmRequest>();
    let settleConfirmation: ((accepted: boolean) => void) | undefined;
    function confirm(request: ConfirmRequest): Promise<boolean> {
        settleConfirmation?.(false);
        confirmation.value = request;
        return new Promise(resolve => { settleConfirmation = resolve; });
    }
    function answerConfirmation(accepted: boolean) {
        const settle = settleConfirmation; settleConfirmation = undefined; confirmation.value = undefined; settle?.(accepted);
    }
    /** 删除步骤会丢掉它的参数和过滤条件且无法撤销，先确认。 */
    async function requestRemoveStep(index: number) {
        const step = config.value?.pipeline[index];
        if (!step || !definition.value || busy.value) return;
        const accepted = await confirm({ title: '删除这个步骤？', message: `第 ${index + 1} 步“${stepTitle(definition.value, step)}”的参数和过滤条件会一起删除，无法撤销。`, confirmLabel: '删除', danger: true });
        // 等待确认期间步骤可能已被移动或删除，按 ID 重新定位。
        const current = config.value?.pipeline.findIndex(item => item.id === step.id) ?? -1;
        if (accepted && current >= 0 && !busy.value) removeStep(current);
    }
    /** 覆盖原文件且不备份时，原文件无法从本工具恢复，开始前再确认一次。 */
    async function requestProcess() {
        if (!config.value || busy.value) return;
        if (config.value.saveMode === 'overwrite' && !config.value.backupEnabled
            && !(await confirm({ title: '不备份就覆盖原文件？', message: '处理结果会直接替换原文件，并且没有启用备份。替换后无法从本工具恢复原文件。', confirmLabel: '继续处理', danger: true }))) return;
        await runPipeline('process');
    }

    function removeStep(index: number) {
        const pipeline = config.value?.pipeline;
        if (!pipeline?.[index]) return;
        pipeline.splice(index, 1);
        const next = pipeline[Math.min(index, pipeline.length - 1)];
        station.value = next ? `step:${next.id}` : 'source';
    }

    // ---------- 任务页 ----------
    async function continueTask(task: Task, mode: 'resume' | 'retry') {
        selectedTaskId.value = task.id;
        await launch({ mode, taskId: task.id }, mode, mode === 'resume' ? '继续未完成' : '重试失败项');
    }
    function showTask(task?: Task) {
        if (task) selectedTaskId.value = task.id;
        page.value = 'tasks';
        refreshTasks().catch(fail);
    }

    // ---------- 恢复页 ----------
    async function checkRestore(source: RestoreSource, scope: RestoreScope = 'all') {
        if (busy.value) return;
        restoreForm.kind = source.kind;
        if (source.kind === 'task') restoreForm.taskId = source.taskId;
        else { restoreForm.backupDir = source.backupDir; restoreForm.outputDir = source.outputDir; }
        if (restoreScope.value !== scope) restoreChoices.value = new Map();
        restoreScope.value = scope;
        page.value = 'restore';
        await recheckRestore();
    }
    async function recheckRestore() {
        if (busy.value) return;
        const source = restoreSource.value;
        if (!source) { fail(restoreForm.kind === 'task' ? '请选择一个有备份的任务' : '请选择备份文件夹和恢复目标文件夹'); return; }
        restorePreview.value = undefined;
        const request: JobRequest = source.kind === 'task' ? { mode: 'restore-preview', taskId: source.taskId } : { mode: 'restore-export-preview', backupDir: source.backupDir, outputDir: source.outputDir };
        await launch(request, 'restore-check', '检查备份', state => {
            // 文件夹对话框可能迟于检查返回；即使编辑后改回相同路径，也必须使用新检查。
            if (restoreSource.value === source) restorePreview.value = state.preview as RestorePreview | undefined;
        });
    }
    async function restoreSelected(selection: Selection[], preview: RestorePreview) {
        const source = restoreSource.value;
        if (!source || busy.value || !preview || preview !== restorePreview.value || preview.cancelled || !selection.length) return;
        const request: JobRequest = source.kind === 'task' ? { mode: 'restore', taskId: source.taskId, selection } : { mode: 'restore-export', backupDir: source.backupDir, outputDir: source.outputDir, selection };
        await launch(request, 'restore', '恢复所选文件', () => { restorePreview.value = undefined; notice.value = '恢复已结束。重新检查可查看文件的最新状态。'; });
    }

    /** 在资源管理器中打开任务的来源、输出或备份文件夹；文件夹已不存在时给出错误。 */
    async function revealFolder(path?: string | null) { if (path) try { error.value = ''; await openFolder(path); } catch (cause) { fail(cause); } }
    async function openSource(id: string) { try { await openProviderSource(id); } catch (cause) { fail(cause); } }
    async function installDependency(provider: Provider) {
        if (!provider.dependency?.automatic || busy.value) return;
        page.value = 'tools';
        await launch({ mode: 'dependency-install', providerId: provider.id }, 'dependency', `安装 ${provider.displayName}`);
    }

    return {
        page, boot, config, tasks, loading, error, notice, station, scan, scanStale,
        maintenanceBusy, storagePreview, previewStorage, cleanStorage,
        selectedTaskId, restoreForm, restorePreview, restoreScope, restoreChoices,
        job, submitting, closing, definition, busy, missingProviders, blockedSteps,
        fail, initialize, refreshTasks, refreshProviders, browse, saveConfig, installDependency,
        launch, cancelJob, dismissJob, readJobResults, openJobReport, requestClose, stop: () => { stopped = true; clearTimeout(timer); },
        runPipeline, useDroppedSource, addStep, moveStep, moveStepTo, toggleStep, removeStep, updateStep,
        confirmation, confirm, answerConfirmation, requestRemoveStep, requestProcess,
        continueTask, showTask, revealFolder, checkRestore, recheckRestore, restoreSelected, openSource,
    };
}

export type Workbench = ReturnType<typeof createWorkbench>;
export const workbenchKey: InjectionKey<Workbench> = Symbol('workbench');
export function useWorkbench(): Workbench {
    const workbench = inject(workbenchKey);
    if (!workbench) throw new Error('工作台未初始化');
    return workbench;
}
