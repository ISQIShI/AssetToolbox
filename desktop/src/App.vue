<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { call, chooseFolder, openReport, openProviderSource } from './api';
import { bytes, processingRequest, resetParameters, createStep } from './model';
import StepEditor from './StepEditor.vue';
import ProviderInventory from './ProviderInventory.vue';
import RestoreTable from './RestoreTable.vue';
import type { Bootstrap, Configuration, JobRequest, JobState, RestorePreview, RestoreScope, ScanPreview, Selection, Task, Provider } from './types';
const page = ref<'process' | 'history' | 'restore'>('process');
const boot = ref<Bootstrap>(), config = ref<Configuration>(), tasks = ref<Task[]>([]), selectedTask = ref<Task>();
const error = ref(''), notice = ref(''), loading = ref(true), submitting = ref(false), cancelled = ref(false), closing = ref(false);
const jobId = ref(''), job = ref<JobState>(), jobTitle = ref(''), scan = ref<ScanPreview>();
const jobPage = ref<'process' | 'history' | 'restore'>('process');
const restorePreview = ref<RestorePreview>(), restoreScope = ref<RestoreScope>('all'), restoreContext = ref<JobRequest>(), restoreKey = ref(0);
const exportBackup = ref(''), exportOutput = ref(''), historySearch = ref('');
const busy = computed(() => submitting.value || Boolean(job.value && !job.value.done));
const enabledCount = computed(() => config.value?.pipeline.filter(step => step.enabled).length || 0);
const missingDependencies = computed(() => config.value?.pipeline.some(step => step.enabled && boot.value?.definition?.providers.find(provider => provider.id === step.provider)?.availability?.available === false) || false);
async function refreshProviders() {
    try { const providers = await call<Provider[]>('providers'); if (boot.value?.definition) boot.value.definition.providers = providers; }
    catch (cause) { fail(cause); }
}
const historyRows = computed(() => tasks.value.filter(task => `${task.source || ''} ${task.id}`.toLowerCase().includes(historySearch.value.toLowerCase())));
const percent = computed(() => job.value?.total ? Math.min(100, Math.round(job.value.processed / job.value.total * 100)) : 0);
const phases: Record<string, string> = { starting: '正在启动', scanning: '扫描文件', checking: '检查文件', processing: '正在处理', restoring: '正在恢复', finished: '已结束' };
let timer: ReturnType<typeof setTimeout> | undefined, unlisten: (() => void) | undefined;
let completion: ((state: JobState) => void) | undefined;
const fail = (cause: unknown) => { error.value = String(cause instanceof Error ? cause.message : cause); };
async function refreshTasks() { tasks.value = await call<Task[]>('tasks'); if (selectedTask.value) selectedTask.value = tasks.value.find(task => task.taskFile === selectedTask.value?.taskFile); }
async function initialize() {
    try { boot.value = await call<Bootstrap>('bootstrap'); if (boot.value.config) config.value = { ...boot.value.config }; await refreshTasks(); }
    catch (cause) { fail(cause); } finally { loading.value = false; }
}
async function pick(key: 'sourceDir' | 'outputDir' | 'backupDir') {
    try { const value = await chooseFolder({ sourceDir: '选择源文件夹', outputDir: '选择另存文件夹', backupDir: '选择备份文件夹' }[key], config.value?.[key] || undefined); if (value && config.value) config.value[key] = value; } catch (cause) { fail(cause); }
}
async function pickExport(key: 'backup' | 'output') {
    try { const value = await chooseFolder(key === 'backup' ? '选择独立备份文件夹' : '选择恢复目标文件夹'); if (value) { if (key === 'backup') exportBackup.value = value; else exportOutput.value = value; } } catch (cause) { fail(cause); }
}
async function save() {
    if (!config.value) return;
    error.value = ''; notice.value = '';
    try { config.value = await call<Configuration>('save', config.value); notice.value = '配置已保存，下次打开自动恢复。'; } catch (cause) { fail(cause); }
}
async function poll() {
    try {
        const state = await call<JobState>('poll', { id: jobId.value }); job.value = state;
        if (!state.done) { timer = setTimeout(poll, 250); return; }
        completion?.(state); completion = undefined;
        try { await refreshTasks(); } catch (cause) { fail(cause); }
        if (closing.value) await getCurrentWindow().close();
    } catch (cause) {
        fail(cause); job.value = { ...(job.value || { processed: 0, total: 0 }), phase: 'finished', done: true, exitCode: 1, error: String(cause) };
        closing.value = false;
    }
}
async function launch(request: JobRequest, title: string, finished?: (state: JobState) => void) {
    if (busy.value) return;
    error.value = ''; cancelled.value = false; jobId.value = ''; submitting.value = true;
    try {
        const result = await call<{ id: string }>('start', request);
        jobId.value = result.id; jobTitle.value = title; completion = finished;
        jobPage.value = request.mode.startsWith('restore') ? 'restore' : ['preview', 'process'].includes(request.mode) ? 'process' : 'history';
        job.value = { phase: 'starting', done: false, processed: 0, total: 0 };
        if (cancelled.value || closing.value) {
            try { await call('cancel', { id: result.id }); } catch (cause) { fail(cause); }
        }
        await nextTick(); document.querySelector('.job-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        void poll();
    } catch (cause) { fail(cause); } finally { submitting.value = false; }
}
async function processResources(mode: 'preview' | 'process') {
    if (!config.value || busy.value) return;
    error.value = ''; notice.value = '';
    try {
        const normalized = await call<Configuration>('normalize', config.value);
        const request = processingRequest(normalized, mode);
        if (mode === 'process') {
            try { await call('save', normalized); } catch (cause) { notice.value = `无法记住配置，本次仍继续处理：${cause}`; }
        }
        scan.value = undefined;
        await launch(request, mode === 'preview' ? '处理预览' : '处理资源', state => { if (mode === 'preview' && state.preview) scan.value = state.preview as ScanPreview; });
    } catch (cause) { fail(cause); }
}
function addStep(operationId = 'compress') {
    if (!config.value || !boot.value?.definition || config.value.pipeline.length >= 64) return;
    const definition = boot.value.definition;
    const support = definition.providers.flatMap(provider => provider.supports).find(item => item.operation === operationId && item.resourceType === 'png')
        || definition.providers.flatMap(provider => provider.supports).find(item => item.operation === operationId);
    if (support) config.value.pipeline.push(createStep(definition, support.resourceType, operationId));
}
function moveStep(index: number, direction: number) {
    if (!config.value || index + direction < 0 || index + direction >= config.value.pipeline.length) return;
    const [step] = config.value.pipeline.splice(index, 1); config.value.pipeline.splice(index + direction, 0, step!);
}
async function cancel() {
    cancelled.value = true;
    if (submitting.value || !jobId.value) return;
    try { await call('cancel', { id: jobId.value }); } catch (cause) { cancelled.value = false; fail(cause); }
}
async function previewTask(task: Task, scope: RestoreScope = 'all') {
    restoreContext.value = { mode: 'restore-preview', taskFile: task.taskFile }; restoreScope.value = scope;
    restorePreview.value = undefined; restoreKey.value++; page.value = 'restore';
    await refreshRestore();
}
async function previewExport() {
    if (!exportBackup.value.trim() || !exportOutput.value.trim()) { error.value = '请选择备份和恢复目标文件夹'; return; }
    restoreContext.value = { mode: 'restore-export-preview', backupDir: exportBackup.value.trim(), outputDir: exportOutput.value.trim() };
    restoreScope.value = 'all'; restorePreview.value = undefined; restoreKey.value++;
    await refreshRestore();
}
async function refreshRestore() {
    if (!restoreContext.value) return;
    await launch(restoreContext.value, '检查备份与目标', state => {
        if (state.preview) restorePreview.value = state.preview as RestorePreview;
        else restorePreview.value = undefined;
    });
}
async function restore(selection: Selection[]) {
    if (!restoreContext.value || !selection.length) return;
    const request: JobRequest = { ...restoreContext.value, mode: restoreContext.value.mode === 'restore-export-preview' ? 'restore-export' : 'restore', selection };
    await launch(request, '恢复所选文件', () => { restorePreview.value = undefined; notice.value = '恢复已结束；可刷新预览查看最新状态。'; });
}
async function continueTask(task: Task, mode: 'resume' | 'retry') { await launch({ mode, taskFile: task.taskFile }, mode === 'resume' ? '继续未完成文件' : '重试处理失败项'); }
async function showReport() { try { await openReport(jobId.value); } catch (cause) { fail(cause); } }
function date(value?: string) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
onMounted(async () => {
    await initialize();
    try {
        unlisten = await getCurrentWindow().onCloseRequested(async event => {
            if (busy.value) { event.preventDefault(); closing.value = true; await cancel(); }
        });
    } catch { /* 浏览器测试环境不注册原生窗口事件。 */ }
});
onUnmounted(() => { clearTimeout(timer); unlisten?.(); });
</script>
<template>
  <div class="app-shell">
    <aside class="sidebar"><div class="brand"><span class="brand-icon">↘</span><div><strong>资源工具箱</strong><small>ASSET TOOLBOX</small></div></div>
      <nav aria-label="工作区"><button :class="{ active: page === 'process' }" @click="page = 'process'"><span>◫</span> 处理资源</button><button :class="{ active: page === 'history' }" @click="page = 'history'; refreshTasks().catch(fail)"><span>◷</span> 任务历史 <small>{{ tasks.length }}</small></button><button :class="{ active: page === 'restore' }" @click="page = 'restore'"><span>↶</span> 备份恢复</button></nav>
      <div class="sidebar-note"><span class="online-dot"></span> 本地处理<p>资源、操作与提供方分离<br>配置随工具文件夹保存</p><small>DESKTOP 1.0</small></div>
    </aside>
    <main>
      <header class="page-heading"><div><span class="eyebrow">{{ page === 'process' ? 'WORKSPACE' : page === 'history' ? 'TASKS' : 'RESTORE' }}</span><h1>{{ page === 'process' ? '按步骤处理资源' : page === 'history' ? '任务历史' : '从备份恢复' }}</h1><p>{{ page === 'process' ? '组合压缩与图片缩放，按顺序执行适用步骤。' : page === 'history' ? '继续未完成文件，或只重试失败项。成功项会自动跳过。' : '先检查内容与冲突，再选择需要恢复的文件。' }}</p></div><span class="local-badge">● 本地工具</span></header>
      <div v-if="error" role="alert" class="notice error"><span>{{ error }}</span><button aria-label="关闭错误" @click="error = ''">×</button></div>
      <div v-if="notice" role="status" class="notice"><span>{{ notice }}</span><button aria-label="关闭提示" @click="notice = ''">×</button></div>
      <div v-for="warning in boot?.warnings" :key="warning" class="notice warning">{{ warning }}</div>
      <div v-if="boot?.configError" class="notice error">模块加载失败：{{ boot.configError }}。任务历史和备份恢复仍可使用。</div>
      <div v-if="loading" class="panel empty">正在加载模块和配置…</div>
      <template v-else-if="page === 'process' && config && boot?.definition">
        <ProviderInventory :providers="boot.definition.providers" :disabled="busy" @refresh="refreshProviders" @open-source="openProviderSource($event).catch(fail)" />
        <section class="panel"><div class="section-heading"><div><h2><span class="step">01</span> 文件夹与保存方式</h2><p>子目录结构会保留，未启用的资源在另存时直接复制。</p></div></div>
          <label class="field">源文件夹<div class="path-input"><input v-model="config.sourceDir" :disabled="busy" placeholder="选择或粘贴文件夹路径" aria-label="源文件夹"><button :disabled="busy" @click="pick('sourceDir')">浏览…</button></div></label>
          <div class="save-options"><label class="save-option" :class="{ chosen: config.saveMode === 'overwrite' }"><input v-model="config.saveMode" type="radio" value="overwrite" :disabled="busy"><div><strong>覆盖原文件</strong><small>全部步骤成功后替换</small></div></label><label class="save-option" :class="{ chosen: config.saveMode === 'saveAs' }"><input v-model="config.saveMode" type="radio" value="saveAs" :disabled="busy"><div><strong>另存为</strong><small>保存到新位置，保留原文件</small></div></label></div>
          <label v-if="config.saveMode === 'saveAs'" class="field">另存文件夹<div class="path-input"><input v-model="config.outputDir" :disabled="busy" aria-label="另存文件夹" placeholder="输入或选择输出路径"><button :disabled="busy" @click="pick('outputDir')">浏览…</button></div></label>
          <template v-else><label class="inline-check"><input v-model="config.backupEnabled" type="checkbox" :disabled="busy">启用备份 <small>保存本次被替换文件的原始内容</small></label><label v-if="config.backupEnabled" class="field">备份文件夹<div class="path-input"><input v-model="config.backupDir" :disabled="busy" aria-label="备份文件夹" placeholder="输入或选择备份路径"><button :disabled="busy" @click="pick('backupDir')">浏览…</button></div></label></template>
        </section>
        <section class="processors"><div class="section-heading"><div><h2><span class="step">02</span> 处理步骤 <span class="count">{{ enabledCount }} / {{ config.pipeline.length }} 已启用</span></h2><p>同类资源按步骤顺序执行；全部步骤成功后才写入文件。体积变化为负值表示增大。</p></div><div class="actions"><button :disabled="busy" @click="addStep()">添加步骤</button><button :disabled="busy" @click="addStep('image-resize')">添加图片缩放</button><button :disabled="busy" @click="config = resetParameters(config!, boot!.definition!)">恢复默认参数</button></div></div>
          <div class="module-grid"><StepEditor v-for="(step, index) in config.pipeline" :key="step.id" :model-value="step" :definition="boot.definition" :index="index" :count="config.pipeline.length" :disabled="busy" @update:model-value="config.pipeline[index] = $event" @remove="config.pipeline.splice(index, 1)" @move="moveStep(index, $event)" /></div>
          <div v-if="!config.pipeline.length" class="panel empty">添加资源类型、处理操作和实现提供方。没有启用步骤的已知资源在另存时原样复制。</div>
        </section>
        <div class="action-bar"><div><strong>准备好后开始处理</strong><small>开始或点击保存配置后，下次自动恢复当前设置。</small></div><div class="actions"><button :disabled="busy" @click="save">保存配置</button><button :disabled="busy" @click="processResources('preview')">扫描预览</button><button class="primary" :disabled="busy || missingDependencies || !boot.definition.resourceTypes.length" @click="processResources('process')">开始处理 <span>→</span></button></div></div>
        <section v-if="scan" class="panel"><h2>扫描结果</h2><div class="stat-row"><div><strong>{{ scan.total }}</strong><span>资源文件</span></div><div><strong>{{ bytes(scan.totalBytes) }}</strong><span>原始体积</span></div><div><strong>{{ scan.enabledFiles }}</strong><span>启用处理</span></div><div><strong>{{ scan.conflicts }}</strong><span>输出冲突</span></div></div><p v-if="scan.cancelled" class="notice warning">扫描已取消，结果不完整。</p><div class="scan-modules"><span v-for="module in scan.resources" :key="module.id">{{ module.name }} · {{ module.count }} 项 · {{ bytes(module.bytes) }} · {{ module.enabled ? '已启用' : '未启用' }}</span></div><p v-for="issue in scan.issues" :key="issue" class="notice warning">{{ issue }}</p></section>
      </template>
      <template v-else-if="page === 'history'">
        <section class="panel"><div class="section-heading"><h2>所有任务 <span class="count">{{ tasks.length }}</span></h2><div class="actions"><input v-model="historySearch" aria-label="搜索任务" placeholder="搜索源路径或任务编号"><button :disabled="busy" @click="refreshTasks().catch(fail)">刷新</button></div></div>
          <div class="table-scroll"><table><thead><tr><th>源文件夹 / 时间</th><th class="number">已完成</th><th class="number">待处理</th><th class="number">失败</th><th>状态</th></tr></thead><tbody><tr v-for="task in historyRows" :key="task.id" class="task-row" :class="{ selected: selectedTask?.id === task.id }" @click="selectedTask = task"><td><button class="task-select" @click.stop="selectedTask = task"><strong>{{ task.source || task.id }}</strong><small>{{ date(task.createdAt) }}</small></button></td><td class="number">{{ task.completed ?? '—' }}</td><td class="number">{{ task.pending ?? '—' }}</td><td class="number">{{ task.failed ?? '—' }}</td><td><span class="badge" :class="task.error || task.failed ? 'conflict' : task.canResume ? 'pending' : 'restored'">{{ task.error ? '无法读取' : task.restoreStarted ? '已开始恢复' : task.canResume ? '可继续' : task.failed ? '有失败项' : '已完成' }}</span></td></tr><tr v-if="!historyRows.length"><td colspan="5" class="empty">{{ tasks.length ? '没有匹配的任务' : '还没有任务。开始处理后，会在这里保存处理进度。' }}</td></tr></tbody></table></div>
        </section>
        <section v-if="selectedTask" class="panel"><div class="section-heading"><div><h2>任务详情</h2><p>{{ selectedTask.id }}</p></div></div><p v-if="selectedTask.error" class="notice error">{{ selectedTask.error }}</p><div class="path-summary"><span>源路径</span><code>{{ selectedTask.source }}</code><span>输出</span><code>{{ selectedTask.outputDir || '覆盖原文件' }}</code><span>备份</span><code>{{ selectedTask.backupSession || '未启用备份' }}</code></div><p class="muted">已备份 {{ selectedTask.backupCount || 0 }} 项 · 已恢复 {{ selectedTask.restored || 0 }} 项 · 恢复失败 {{ selectedTask.restoreFailed || 0 }} 项</p><div class="actions wrap"><button class="primary" :disabled="busy || !selectedTask.canResume" @click="continueTask(selectedTask!, 'resume')">继续未完成</button><button :disabled="busy || !selectedTask.canRetry" @click="continueTask(selectedTask!, 'retry')">仅重试处理失败项</button><button :disabled="busy || !selectedTask.backupCount" @click="previewTask(selectedTask!)">预览备份与恢复</button><button :disabled="busy || !selectedTask.canContinueRestore" @click="previewTask(selectedTask!, 'continue')">继续上次恢复</button><button :disabled="busy || !selectedTask.canRetryRestore" @click="previewTask(selectedTask!, 'retry')">重试恢复失败项</button></div></section>
      </template>
      <template v-else-if="page === 'restore'">
        <section class="panel"><div class="section-heading"><div><h2>选择恢复来源</h2><p>有任务记录的备份，请从历史中选择。没有任务记录的独立备份，可指定目标导出。</p></div><button :disabled="busy" @click="page = 'history'">从任务历史选择 →</button></div><details><summary>恢复没有任务记录的独立备份</summary><div class="export-grid"><label class="field">独立备份文件夹<div class="path-input"><input v-model="exportBackup" :disabled="busy" aria-label="独立备份文件夹"><button :disabled="busy" @click="pickExport('backup')">浏览…</button></div></label><label class="field">恢复目标文件夹<div class="path-input"><input v-model="exportOutput" :disabled="busy" aria-label="恢复目标文件夹"><button :disabled="busy" @click="pickExport('output')">浏览…</button></div></label></div><p class="muted">选择包含原始文件的备份批次目录。目标已有不同内容时会列为冲突。</p><button class="primary" :disabled="busy" @click="previewExport">检查独立备份</button></details></section>
        <RestoreTable v-if="restorePreview" :key="restoreKey" :preview="restorePreview" :scope="restoreScope" :disabled="busy" @restore="restore" @refresh="refreshRestore" />
        <section v-else-if="restoreContext && !busy" class="panel empty"><p>点击刷新，查看当前可恢复的文件。</p><button @click="refreshRestore">刷新预览</button></section>
        <section v-else-if="!busy" class="empty restore-empty"><span>↶</span><h2>恢复前先看清每一项</h2><p>可恢复、已恢复与冲突文件会分别标记。<br>只处理你勾选的文件，原始备份始终保留。</p></section>
      </template>
      <section v-if="job && (!job.done || (page === jobPage && !job.preview))" class="job-panel" :data-job-id="jobId" role="status" aria-live="polite"><div class="section-heading"><div><span class="eyebrow">{{ job.done ? (job.cancelled ? 'CANCELLED' : job.exitCode ? 'NEEDS ATTENTION' : 'COMPLETED') : 'PROCESSING' }}</span><h2>{{ jobTitle }} <span class="badge" :class="job.error || job.summary?.failed ? 'conflict' : 'pending'">{{ closing ? '正在安全退出' : cancelled && !job.done ? '等待当前文件结束' : job.done ? job.cancelled ? '已取消' : job.error || job.summary?.failed ? '有失败项' : '已完成' : phases[job.phase] || job.phase }}</span></h2></div><div class="actions"><button v-if="!job.done" :disabled="cancelled" @click="cancel">取消任务</button><button v-if="job.done && job.reportDirectory" @click="showReport">打开报告</button><button v-if="job.done && job.task" @click="selectedTask = job!.task; page = 'history'">查看任务</button><button v-if="job.done" aria-label="关闭任务结果" @click="job = undefined">关闭</button></div></div>
        <div v-if="!job.done" class="progress" :class="{ indeterminate: !job.total }"><span :style="{ width: `${percent}%` }"></span></div>
        <div class="progress-caption"><span>{{ job.processed }} / {{ job.total }} 项</span><span>{{ Math.floor(job.elapsedSeconds || 0) }} 秒</span></div><p v-if="job.current" class="current-file">{{ job.current }}</p>
        <p v-if="job.error" class="notice error">{{ job.error }}</p><p v-if="job.reportWarning" class="notice warning">{{ job.reportWarning }}</p><p v-for="warning in job.recoveryWarnings" :key="warning" class="notice warning">{{ warning }}</p>
        <div v-if="job.summary" class="stat-row"><div><strong>{{ job.summary.processed ?? job.summary.restored ?? 0 }}</strong><span>{{ job.summary.restored === undefined ? '已处理' : '已恢复' }}</span></div><div><strong>{{ job.summary.skipped }}</strong><span>已跳过</span></div><div><strong>{{ job.summary.failed }}</strong><span>失败项</span></div><div><strong>{{ bytes(job.summary.savedBytes ?? job.summary.restoredBytes) }}</strong><span>{{ job.summary.restored === undefined ? '体积变化' : '恢复体积' }}</span></div><div v-if="job.summary.copied"><strong>{{ job.summary.copied }}</strong><span>原样复制</span></div><div v-if="job.summary.backedUp"><strong>{{ job.summary.backedUp }}</strong><span>已备份</span></div></div>
        <p v-if="job.cancelled" class="muted">{{ job.task ? '本次已完成的文件已记录；可从任务历史继续剩余项。' : '已停止处理，可重新发起预览或导出。' }}</p><p v-if="job.message" class="muted">{{ job.message }}</p>
      </section>
      <footer class="page-footer">资源工具箱 · {{ boot?.definition?.providers.length || 0 }} 个提供方 <span>本地处理 · 有序步骤 · 安全恢复</span></footer>
    </main>
  </div>
</template>
