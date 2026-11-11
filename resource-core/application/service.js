const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { JobSession } = require('./job-session');
const { acquire, alive } = require('./lock');
const { fail, record, canonical, within } = require('./policy');
const { localContext, policyContext, assertContext } = require('./context');
const { API, RESPONSE, JOB, ACTION_FIELDS, inputSchemas } = require('./contract');
const ROOT = path.join(__dirname, '..', 'data', 'jobs', 'v2');
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const read = filename => JSON.parse(fs.readFileSync(filename, 'utf8'));
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
function writeExclusive(filename, value) {
    const fd = fs.openSync(filename, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
}
function page(items, { offset = 0, limit = 50 }) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('INVALID_REQUEST', '分页要求 offset >= 0，limit 为 1–100');
    return { items: items.slice(offset, offset + limit), total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null };
}
function fieldsSchema(fields) {
    return { type: 'object', additionalProperties: false, properties: Object.fromEntries(fields.map(field => {
        const schema = { type: field.type === 'text' || field.type === 'enum' ? 'string' : field.type, default: field.default, description: [field.label, field.hint].filter(Boolean).join('：') };
        if (field.min !== undefined) Object.assign(schema, { minimum: field.min, maximum: field.max, multipleOf: 10 ** -field.decimalPlaces });
        if (field.choices) schema.enum = field.choices.map(choice => choice.value);
        if (field.maxLength) schema.maxLength = field.maxLength;
        return [field.key, schema];
    })) };
}
function capabilities() {
    const catalog = require('../framework/registry').describe();
    for (const operation of catalog.operations) operation.parametersSchema = fieldsSchema(operation.fields);
    for (const provider of catalog.providers) for (const adapter of provider.adapters) adapter.providerOptionsSchema = fieldsSchema(adapter.fields);
    return { ...catalog, applicationApi: API, inputSchemas, notes: '字段 schema 供发现使用；公共参数、跨字段约束和版本由 validate 再次核验。预览仅扫描，不测量或编码。' };
}

class ApplicationService {
    constructor(context) {
        this.context = assertContext(typeof context === 'string' ? policyContext(context) : context);
        this.policy = this.context.policy;
        this.scope = this.context.scope;
        this.directory = ROOT;
        this.session = new JobSession();
    }
    static forDesktop() { return new ApplicationService(localContext({ settings: true })); }
    taskFile(id) {
        if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) fail('INVALID_REQUEST', '无效任务 ID');
        const root = require('../tasks').TASK_ROOT, filename = path.join(root, id, 'task.json');
        if (!fs.existsSync(filename)) fail('NOT_FOUND', '任务不存在');
        if (fs.realpathSync(filename) !== filename) fail('PATH_FORBIDDEN', '任务元数据不能通过链接读取');
        return filename;
    }
    normalize(input) {
        record(input, ['mode', 'folder', 'outputDir', 'backupDir', 'pipeline', 'taskId', 'selection', 'providerId']);
        let request;
        if (['process', 'preview'].includes(input.mode)) {
            record(input, ['mode', 'folder', 'outputDir', 'backupDir', 'pipeline']);
            request = { mode: input.mode, folder: canonical(input.folder), pipeline: require('../framework/registry').normalizePipeline(input.pipeline) };
            for (const key of ['outputDir', 'backupDir']) if (input[key] !== undefined) request[key] = canonical(input[key]);
            if (request.outputDir && request.backupDir) fail('INVALID_REQUEST', '另存与覆盖备份不能同时启用');
        } else if (['resume', 'retry', 'restore-preview', 'restore', 'restore-retry'].includes(input.mode)) {
            record(input, ['mode', 'taskId', ...(['restore', 'restore-retry'].includes(input.mode) ? ['selection'] : [])]);
            request = { mode: input.mode, taskFile: this.taskFile(input.taskId) };
            if (input.mode === 'restore' || input.mode === 'restore-retry') {
                if (!Array.isArray(input.selection) || !input.selection.length) fail('INVALID_REQUEST', '恢复需要预览返回的非空 selection（含路径和哈希）');
                request.selection = require('../tasks').validateRestoreSelection(require('../tasks').loadTask(request.taskFile).header.source, input.selection);
            }
        } else if (['restore-export-preview', 'restore-export'].includes(input.mode)) {
            record(input, ['mode', 'backupDir', 'outputDir', ...(input.mode === 'restore-export' ? ['selection'] : [])]);
            request = { mode: input.mode, backupDir: canonical(input.backupDir), outputDir: canonical(input.outputDir) };
            if (input.mode === 'restore-export') {
                if (!Array.isArray(input.selection) || !input.selection.length) fail('INVALID_REQUEST', '导出需要预览返回的非空 selection');
                request.selection = require('../tasks').validateRestoreSelection(request.outputDir, input.selection);
            }
        } else if (input.mode === 'dependency-install') {
            record(input, ['mode', 'providerId']);
            if (typeof input.providerId !== 'string' || !require('../framework/registry').providers.has(input.providerId)) fail('INVALID_REQUEST', '未知提供方');
            const info = require('../framework/dependencies/runtime').management(input.providerId);
            if (!info.automatic) fail('MANUAL_INSTALL_REQUIRED', info.reason);
            request = { ...input };
        } else fail('INVALID_REQUEST', '不支持的作业模式');
        this.context.authorize(request);
        if (['process', 'preview'].includes(request.mode)) {
            // 空文件清单只做目录/保存方式预检，不扫描素材或执行提供方。
            require('../engine').prepareFolder(request.folder, { ...request, fileList: [] });
        }
        return request;
    }
    metadata(id) {
        if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id)) fail('INVALID_REQUEST', '无效作业 ID');
        const directory = path.join(this.directory, id);
        if (!fs.existsSync(directory)) fail('NOT_FOUND', '没有该 /2 作业；不读取或迁移旧 /1 作业');
        if (fs.realpathSync(directory) !== directory) fail('PATH_FORBIDDEN', '作业目录不能是链接');
        const meta = read(path.join(directory, 'job.json'));
        if (meta.schema !== JOB || meta.id !== id) fail('UNSUPPORTED_VERSION', '作业格式不支持');
        // 重新授权，防止重启后目录链接发生变化。
        this.context.authorize(meta.request);
        return { ...meta, directory };
    }
    submit(input, idempotencyKey) {
        if (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(idempotencyKey)) fail('INVALID_REQUEST', '提交需要 1–128 字符 idempotencyKey（英文、数字、._:-）');
        const request = this.normalize(input), requestHash = fingerprint(stable(request));
        const id = fingerprint([this.scope, idempotencyKey]), directory = path.join(this.directory, id);
        const unlock = acquire('submission');
        try {
            if (fs.existsSync(directory)) {
                if (this.metadata(id).requestHash !== requestHash) fail('IDEMPOTENCY_CONFLICT', '同一幂等键已用于不同请求');
                return { jobId: id, replayed: true, state: this.status(id) };
            }
            if (this.session.closing || (this.session.job && !this.session.job.exited)) fail('BUSY', '本会话已有活动作业或正在退出');
            // 在占用幂等键之前检查依赖；仅预览允许列出缺失项。
            if (request.mode === 'process') {
                const catalog = require('../framework/registry').describe();
                const missing = catalog.providers.filter(provider => !provider.availability.available && request.pipeline.some(step => step.enabled && step.provider === provider.id));
                if (missing.length) fail('DEPENDENCY_MISSING', missing.map(provider => provider.id + '：' + provider.availability.reason + '；' + provider.acquisition?.instructions).join('\n'));
            }
            fs.mkdirSync(directory, { recursive: true });
            const meta = { schema: JOB, id, scope: this.scope, requestHash, request, createdAt: new Date().toISOString(), ownerPid: process.pid };
            writeExclusive(path.join(directory, 'job.json'), meta);
            try {
                this.session.start(request.mode === 'dependency-install' || !this.policy ? request : { ...request, _automationPolicy: this.policy }, { directory, id });
            } catch (error) {
                fs.writeFileSync(path.join(directory, 'status.json'), JSON.stringify({ phase: 'finished', done: true, exitCode: 1, error: error.message, errorCode: 'START_FAILED' }));
                throw error;
            }
            return { jobId: id, replayed: false };
        } finally { unlock(); }
    }
    rawStatus(id) {
        const meta = this.metadata(id);
        const expired = require('./storage').expiredState(meta.directory);
        if (expired) return expired;
        if (this.session.job?.id === id) {
            const state = this.session.poll(id);
            if (state.errorCode === 'INTERRUPTED' && state.task?.id) state.task = require('../tasks').loadTask(this.taskFile(state.task.id)).info();
            return state;
        }
        let state = { phase: 'starting', done: false };
        try { state = read(path.join(meta.directory, 'status.json')); }
        catch (error) { if (!['ENOENT', 'EBUSY', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
        let worker;
        try { worker = read(path.join(meta.directory, 'worker.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        const exited = fs.existsSync(path.join(meta.directory, 'exit.json'));
        if (!exited && worker && alive(worker.pid)) return { ...state, done: false };
        if (state.done) return state;
        if (!exited && !worker && alive(meta.ownerPid)) return state;
        if (state.task?.id) {
            // 状态文件可能停留在作业开始时，任务事件日志才是崩溃恢复的依据。
            state.task = require('../tasks').loadTask(this.taskFile(state.task.id)).info();
        }
        return { ...state, done: true, phase: 'finished', exitCode: 1, errorCode: 'INTERRUPTED', error: '作业进程已退出；请从 taskId 续跑，不要重复提交新转换' };
    }
    status(id) {
        const state = this.rawStatus(id);
        const { reportDirectory, preview, task, ...summary } = state;
        if (task) { const { taskFile, ...info } = task; summary.task = info; summary.taskId = info.id; }
        if (preview) { const { files, ...info } = preview; summary.preview = info; }
        return { jobId: id, processed: 0, total: 0, ...summary, hasReport: Boolean(reportDirectory) };
    }
    reportLocation(id) {
        const state = this.rawStatus(id);
        if (!state.done) fail('NOT_READY', '作业结束后读取报告');
        if (state.resultsExpired) fail('RESULTS_EXPIRED', '报告与明细已按保留策略清理，作业身份和任务记录仍保留');
        if (!state.reportDirectory) fail('NOT_FOUND', '此作业没有报告');
        const root = path.join(__dirname, '..', 'data', 'reports'), filename = path.join(state.reportDirectory, 'report.json');
        if (!within(root, state.reportDirectory) || fs.realpathSync(filename) !== filename) fail('PATH_FORBIDDEN', '报告路径无效');
        return state.reportDirectory;
    }
    results(id, kind, pagination) {
        const state = this.rawStatus(id);
        if (!state.done) fail('NOT_READY', '作业结束后读取明细');
        if (state.resultsExpired) fail('RESULTS_EXPIRED', '报告与明细已按保留策略清理，不能用同一幂等键重新执行');
        if (!['files', 'audio', 'restore'].includes(kind)) fail('INVALID_REQUEST', 'kind 必须为 files、audio 或 restore');
        if (kind === 'restore') return page(state.preview?.files || [], pagination);
        const filename = path.join(this.reportLocation(id), 'report.json');
        const report = read(filename);
        if (report.schema !== 'asset-toolbox.report/1') fail('UNSUPPORTED_VERSION', '报告版本不支持');
        return { ...page(kind === 'audio' ? report.audioResults || [] : report.files, pagination), summary: report.summary, error: report.error || null };
    }
    dispatch(action, input = {}) {
        if (!Object.hasOwn(ACTION_FIELDS, action)) fail('INVALID_REQUEST', '未知应用操作');
        record(input, ACTION_FIELDS[action]);
        if (inputSchemas[action].required.some(key => !Object.hasOwn(input, key))) fail('INVALID_REQUEST', '请求缺少必需字段');
        switch (action) {
            case 'storage-preview': return require('./storage').preview(this, input);
            case 'storage-clean': return require('./storage').clean(this, input);
            case 'capabilities': return { ...capabilities(), policy: this.policy };
            case 'validate': {
                const request = this.normalize(input.request);
                if (request.taskFile) { delete request.taskFile; request.taskId = input.request.taskId; }
                return { request };
            }
            case 'submit': return this.submit(input.request, input.idempotencyKey);
            case 'status': return this.status(input.jobId);
            case 'cancel': {
                const meta = this.metadata(input.jobId);
                if (!this.rawStatus(input.jobId).done) fs.writeFileSync(path.join(meta.directory, 'cancel'), '');
                return { jobId: input.jobId, requested: true };
            }
            case 'results': return this.results(input.jobId, input.kind || 'files', input);
            case 'jobs': {
                const ids = fs.existsSync(this.directory) ? fs.readdirSync(this.directory).filter(id => /^[a-f0-9]{64}$/.test(id)) : [];
                return page(ids.flatMap(id => {
                    try { const meta = this.metadata(id); return [{ jobId: id, mode: meta.request.mode, createdAt: meta.createdAt }]; }
                    catch (error) { if (['PATH_FORBIDDEN', 'PERMISSION_DENIED'].includes(error.code)) return []; throw error; }
                }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), input);
            }
            case 'tasks': {
                const items = require('../tasks').listTasks().filter(info => {
                    try { this.context.authorize({ mode: (!this.policy || this.policy.allowRestore) && info.backupDir ? 'restore-preview' : 'resume', taskFile: this.taskFile(info.id) }); return true; } catch { return false; }
                }).map(({ taskFile, ...info }) => info);
                return page(items, input);
            }
        }
    }
    shutdown() { return this.session.shutdown(); }
    disconnect() { return this.context.lifetime === 'connection' ? this.shutdown() : Promise.resolve(); }
}
async function respond(service, action, input) {
    try { return { schema: RESPONSE, ok: true, result: await service.dispatch(action, input) }; }
    catch (error) { return { schema: RESPONSE, ok: false, error: { code: ['INVALID_REQUEST', 'UNSUPPORTED_VERSION', 'PATH_FORBIDDEN', 'PERMISSION_DENIED', 'NOT_FOUND', 'BUSY', 'DEPENDENCY_MISSING', 'MANUAL_INSTALL_REQUIRED', 'IDEMPOTENCY_CONFLICT', 'NOT_READY', 'RESULTS_EXPIRED', 'STALE_PREVIEW'].includes(error.code) ? error.code : 'INVALID_REQUEST', message: error.message } }; }
}
module.exports = { ApplicationService, respond, capabilities, page, ACTION_FIELDS };
