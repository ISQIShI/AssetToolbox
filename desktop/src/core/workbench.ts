// 工作台状态：一个 App 实例创建一份，通过 provide/inject 交给视图。
// 所有对核心的调用、作业生命周期（启动、轮询、取消、安全退出）都集中在这里。
import { computed, inject, ref, type InjectionKey } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { call, chooseFolder, openProviderSource, openReport } from './api';
import { createStep, isMissing, processingRequest, providerOf } from './model';
import type { Bootstrap, Configuration, Definition, JobRequest, JobState, Provider, RestorePreview, RestoreScope, ScanPreview, Selection, Step, Task } from './types';

export type Page = 'process' | 'tasks' | 'restore' | 'tools';
export type JobKind = 'preview' | 'process' | 'resume' | 'retry' | 'restore-check' | 'restore' | 'dependency';
export interface ActiveJob { id: string; kind: JobKind; title: string; state: JobState; cancelRequested: boolean }
export type RestoreSource = { kind: 'task'; taskFile: string } | { kind: 'export'; backupDir: string; outputDir: string };

const POLL_MS = 250;

export function createWorkbench() {
    const page = ref<Page>('process');
    const boot = ref<Bootstrap>();
    const config = ref<Configuration>();
    const tasks = ref<Task[]>([]);
    const loading = ref(true);
    const error = ref('');
    const notice = ref('');

    // 处理页：当前选中的处理线站点（source / output / scan / step:<步骤 ID>）与最近一次扫描。
    const station = ref('source');
    const scan = ref<ScanPreview>();
    const scanRequest = ref('');

    // 任务页与恢复页。
    const selectedTaskFile = ref<string>();
    const restoreSource = ref<RestoreSource>();
    const restorePreview = ref<RestorePreview>();
    const restoreScope = ref<RestoreScope>('all');
    const restoreRevision = ref(0);

    // 作业：同一时间最多一个；submitting 覆盖 start 请求尚未返回的窗口。
    const job = ref<ActiveJob>();
    const submitting = ref(false);
    const closing = ref(false);
    let pendingCancel = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let completion: ((state: JobState) => void) | undefined;

    const definition = computed<Definition | undefined>(() => boot.value?.definition || undefined);
    const busy = computed(() => submitting.value || Boolean(job.value && !job.value.state.done));
    const missingProviders = computed(() => definition.value?.providers.filter(isMissing) || []);
    const blockedSteps = computed(() => {
        if (!config.value || !definition.value) return [];
        return config.value.pipeline.map((step, index) => ({ step, index })).filter(({ step }) => step.enabled && isMissing(providerOf(definition.value!, step)));
    });
    const scanStale = computed(() => {
        if (!scan.value || !config.value) return false;
        try { return JSON.stringify(processingRequest(config.value, 'preview', definition.value)) !== scanRequest.value; } catch { return true; }
    });

    const fail = (cause: unknown) => { error.value = String(cause instanceof Error ? cause.message : cause); };

    async function refreshTasks() { tasks.value = await call<Task[]>('tasks'); }
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
    async function poll(id: string) {
        if (job.value?.id !== id) return;
        try {
            const state = await call<JobState>('poll', { id });
            if (job.value?.id !== id) return;
            job.value = { ...job.value, state };
            if (!state.done) { timer = setTimeout(() => void poll(id), POLL_MS); return; }
            const finished = completion; completion = undefined; finished?.(state);
            if (job.value.kind === 'dependency') await refreshProviders();
            // 预览类作业的结果直接显示在所属页面，进度条随之收起。
            if (state.preview && (job.value.kind === 'preview' || job.value.kind === 'restore-check')) job.value = undefined;
            try { await refreshTasks(); } catch (cause) { fail(cause); }
            if (closing.value) await getCurrentWindow().close();
        } catch (cause) {
            fail(cause);
            if (job.value?.id === id) job.value = { ...job.value, state: { ...job.value.state, phase: 'finished', done: true, exitCode: 1, error: String(cause) } };
            closing.value = false;
        }
    }

    async function launch(request: JobRequest, kind: JobKind, title: string, finished?: (state: JobState) => void) {
        if (busy.value) return;
        error.value = ''; pendingCancel = false; submitting.value = true;
        try {
            const { id } = await call<{ id: string }>('start', request);
            completion = finished;
            job.value = { id, kind, title, cancelRequested: pendingCancel, state: { phase: 'starting', done: false, processed: 0, total: 0 } };
            if (pendingCancel || closing.value) {
                job.value.cancelRequested = true;
                try { await call('cancel', { id }); } catch (cause) { fail(cause); }
            }
            void poll(id);
        } catch (cause) { fail(cause); } finally { submitting.value = false; }
    }

    async function cancelJob() {
        if (submitting.value) { pendingCancel = true; return; }
        if (!job.value || job.value.state.done) return;
        job.value.cancelRequested = true;
        try { await call('cancel', { id: job.value.id }); } catch (cause) { job.value.cancelRequested = false; fail(cause); }
    }

    function dismissJob() { if (job.value?.state.done) job.value = undefined; }

    async function openJobReport() { if (job.value) try { await openReport(job.value.id); } catch (cause) { fail(cause); } }

    /** 窗口关闭：有作业时先协作取消，等桥接确认结束后由 poll 关闭窗口。 */
    async function requestClose(): Promise<boolean> {
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
                scan.value = state.preview as ScanPreview; scanRequest.value = snapshot; station.value = 'scan';
            });
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
    function removeStep(index: number) {
        const pipeline = config.value?.pipeline;
        if (!pipeline?.[index]) return;
        pipeline.splice(index, 1);
        const next = pipeline[Math.min(index, pipeline.length - 1)];
        station.value = next ? `step:${next.id}` : 'source';
    }

    // ---------- 任务页 ----------
    async function continueTask(task: Task, mode: 'resume' | 'retry') {
        selectedTaskFile.value = task.taskFile;
        await launch({ mode, taskFile: task.taskFile }, mode, mode === 'resume' ? '继续未完成' : '重试失败项');
    }
    function showTask(task?: Task) {
        if (task) selectedTaskFile.value = task.taskFile;
        page.value = 'tasks';
        refreshTasks().catch(fail);
    }

    // ---------- 恢复页 ----------
    async function checkRestore(source: RestoreSource, scope: RestoreScope = 'all') {
        restoreSource.value = source; restoreScope.value = scope; restorePreview.value = undefined; restoreRevision.value++;
        page.value = 'restore';
        await recheckRestore();
    }
    async function recheckRestore() {
        const source = restoreSource.value;
        if (!source) return;
        const request: JobRequest = source.kind === 'task' ? { mode: 'restore-preview', taskFile: source.taskFile } : { mode: 'restore-export-preview', backupDir: source.backupDir, outputDir: source.outputDir };
        await launch(request, 'restore-check', '检查备份', state => { restorePreview.value = state.preview as RestorePreview | undefined; });
    }
    async function restoreSelected(selection: Selection[]) {
        const source = restoreSource.value;
        if (!source || !selection.length) return;
        const request: JobRequest = source.kind === 'task' ? { mode: 'restore', taskFile: source.taskFile, selection } : { mode: 'restore-export', backupDir: source.backupDir, outputDir: source.outputDir, selection };
        await launch(request, 'restore', '恢复所选文件', () => { restorePreview.value = undefined; notice.value = '恢复已结束。重新检查可查看文件的最新状态。'; });
    }

    async function openSource(id: string) { try { await openProviderSource(id); } catch (cause) { fail(cause); } }
    async function installDependency(provider: Provider) {
        if (!provider.dependency?.automatic || busy.value) return;
        page.value = 'tools';
        await launch({ mode: 'dependency-install', providerId: provider.id }, 'dependency', `安装 ${provider.displayName}`);
    }

    return {
        page, boot, config, tasks, loading, error, notice, station, scan, scanStale,
        selectedTaskFile, restoreSource, restorePreview, restoreScope, restoreRevision,
        job, submitting, closing, definition, busy, missingProviders, blockedSteps,
        fail, initialize, refreshTasks, refreshProviders, browse, saveConfig, installDependency,
        launch, cancelJob, dismissJob, openJobReport, requestClose, stop: () => clearTimeout(timer),
        runPipeline, addStep, moveStep, removeStep, updateStep,
        continueTask, showTask, checkRestore, recheckRestore, restoreSelected, openSource,
    };
}

export type Workbench = ReturnType<typeof createWorkbench>;
export const workbenchKey: InjectionKey<Workbench> = Symbol('workbench');
export function useWorkbench(): Workbench {
    const workbench = inject(workbenchKey);
    if (!workbench) throw new Error('工作台未初始化');
    return workbench;
}
