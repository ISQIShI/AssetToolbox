// 仅维护应用自身的作业明细与报告。素材、任务日志、备份和依赖不属于清理范围。
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { fail, record, within } = require('./policy');
const { acquire } = require('./lock');
const CORE = fs.realpathSync(path.join(__dirname, '..'));
const JOBS = path.join(CORE, 'data', 'jobs', 'v6');
const REPORTS = path.join(CORE, 'data', 'reports');
const SCHEMA = 'asset-toolbox.retention/1';
const JOB_FILES = ['job.json', 'request.json', 'status.json', 'worker.json', 'exit.json', 'cancel', 'retention.json', 'dispatch.json'];
const REPORT_FILES = ['report.json', 'files.csv', 'audio.csv'];
const PAYLOAD_FILES = ['request.json', 'status.json', 'cancel'];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function safe(filename, directory = false, optional = false) {
    if (!within(CORE, filename) || filename === CORE) fail('PATH_FORBIDDEN', '清理路径必须位于核心数据目录');
    const parts = path.relative(CORE, filename).split(path.sep);
    let current = CORE;
    for (let i = 0; i < parts.length; i++) {
        current = path.join(current, parts[i]);
        let stat;
        try { stat = fs.lstatSync(current); } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
        if (stat.isSymbolicLink() || fs.realpathSync(current) !== current) fail('PATH_FORBIDDEN', '清理路径不能经过链接');
        const isDirectory = i < parts.length - 1 || directory;
        if (isDirectory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1) fail('PATH_FORBIDDEN', '清理只接受普通目录及非硬链接文件');
        if (i === parts.length - 1) return stat;
    }
}
function snapshot(filename) {
    const before = safe(filename), digest = createHash('sha256'), fd = fs.openSync(filename, 'r');
    try {
        const opened = fs.fstatSync(fd);
        if (opened.ino !== before.ino || opened.dev !== before.dev) fail('STALE_PREVIEW', '文件在读取前发生变化');
        const buffer = Buffer.alloc(64 * 1024);
        let size;
        while ((size = fs.readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0, size));
    } finally { fs.closeSync(fd); }
    const after = safe(filename);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.ino !== after.ino) fail('STALE_PREVIEW', '文件在读取期间发生变化');
    return { bytes: after.size, mtimeMs: after.mtimeMs, sha256: digest.digest('hex') };
}
function json(filename) { safe(filename); return JSON.parse(fs.readFileSync(filename, 'utf8')); }
function reportId(directory) {
    const id = path.basename(directory);
    if (path.join(REPORTS, id) !== directory || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) fail('PATH_FORBIDDEN', '报告必须位于固定报告目录下');
    return id;
}
function readMarker(directory) {
    const filename = path.join(directory, 'retention.json');
    if (!safe(filename, false, true)) return null;
    const marker = json(filename);
    if (marker.schema !== SCHEMA) fail('UNSUPPORTED_VERSION', '清理记录版本不支持');
    if (marker.jobId !== path.basename(directory) || !marker.state?.done || !Array.isArray(marker.files) || !/^[a-f0-9]{64}$/.test(marker.fingerprint)) fail('INVALID_REQUEST', '清理记录损坏');
    if (marker.reportId) reportId(path.join(REPORTS, marker.reportId));
    const seen = new Set();
    for (const file of marker.files) {
        const names = file.area === 'job' ? PAYLOAD_FILES : file.area === 'report' && marker.reportId ? REPORT_FILES : [];
        const key = file.area + '/' + file.name;
        if (!names.includes(file.name) || seen.has(key) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) fail('INVALID_REQUEST', '清理记录包含无效文件');
        seen.add(key);
    }
    return marker;
}
function expiredState(directory) {
    const marker = readMarker(directory);
    return marker ? { ...marker.state, resultsExpired: true, cleanedAt: marker.createdAt } : null;
}
function days(value = 30) {
    if (!Number.isInteger(value) || value < 1 || value > 3650) fail('INVALID_REQUEST', '保留天数必须为 1–3650 的整数');
    return value;
}
function authorize(service) {
    if (service.context.policy) fail('PERMISSION_DENIED', '存储维护仅限受信任的桌面或显式 --local CLI；目录权限不授予全局清理权限');
}
function taskProtection(service, state, meta) {
    const taskId = state.task?.id || (meta.request.taskFile ? path.basename(path.dirname(meta.request.taskFile)) : null);
    if (!taskId) return;
    const file = service.taskFile(taskId);
    safe(file);
    safe(path.join(path.dirname(file), 'events.jsonl'), false, true);
    const info = require('../tasks').loadTask(file).info();
    if (info.canResume || info.canRetry || (info.restoreStarted && (info.canContinueRestore || info.canRetryRestore))) fail('NOT_READY', '任务尚未完成或仍需继续恢复');
}
function inventory(service) {
    if (!safe(JOBS, true, true)) return [];
    return fs.readdirSync(JOBS).filter(id => /^[a-f0-9]{64}$/.test(id)).map(jobId => {
        try {
            const directory = path.join(JOBS, jobId);
            safe(directory, true); safe(path.join(directory, 'job.json'));
            for (const name of fs.readdirSync(directory)) safe(path.join(directory, name));
            const meta = service.metadata(jobId), marker = readMarker(directory);
            const state = marker ? { ...marker.state, resultsExpired: true } : service.rawStatus(jobId);
            const report = marker?.reportId || (state.reportDirectory ? reportId(state.reportDirectory) : null);
            return { jobId, directory, meta, state, marker, report };
        } catch (error) { return { jobId, error: error.message }; }
    });
}
function inspect(service, entry, all, retentionDays) {
    const result = { jobId: entry.jobId, mode: entry.meta?.request.mode || '', createdAt: entry.meta?.createdAt || '', bytes: 0, eligible: false, reason: '' };
    try {
        if (entry.error) throw Error(entry.error);
        const { directory, meta, state, marker, report } = entry;
        if (!state.done || state.cancelled || state.exitCode !== 0 || state.error) fail('NOT_READY', '仅清理成功结束的作业；运行、失败、中断及取消记录保留');
        if (safe(path.join(directory, 'worker.json'), false, true) && !safe(path.join(directory, 'exit.json'), false, true)) fail('NOT_READY', '工作进程退出尚未确认');
        taskProtection(service, state, meta);
        if (report && all.some(other => other.error || (other.jobId !== entry.jobId && other.report === report))) fail('NOT_READY', '报告引用无法唯一确认，保留以供核对');
        const control = [];
        for (const name of fs.readdirSync(directory).sort()) {
            if (!JOB_FILES.includes(name)) fail('NOT_READY', '作业目录含未知文件，保留以供核对');
            control.push({ name, ...snapshot(path.join(directory, name)) });
        }
        const files = [];
        for (const file of control) if (PAYLOAD_FILES.includes(file.name)) files.push({ area: 'job', ...file });
        if (report && safe(path.join(REPORTS, report), true, true)) {
            for (const name of fs.readdirSync(path.join(REPORTS, report)).sort()) {
                if (!REPORT_FILES.includes(name)) fail('NOT_READY', '报告目录含未知文件，保留以供核对');
                files.push({ area: 'report', name, ...snapshot(path.join(REPORTS, report, name)) });
            }
        } else if (report && !marker) fail('NOT_READY', '报告缺失，保留记录以供核对');
        if (marker) {
            for (const file of files) {
                const approved = marker.files.find(item => item.area === file.area && item.name === file.name);
                if (!approved || approved.sha256 !== file.sha256 || approved.bytes !== file.bytes) fail('STALE_PREVIEW', '中断清理的文件已变化，需人工核对');
            }
        }
        const latest = Math.max(Date.parse(meta.createdAt), ...control.map(file => file.mtimeMs), ...files.map(file => file.mtimeMs));
        result.finishedBefore = new Date(marker ? marker.finishedBefore : latest).toISOString();
        if (!marker && latest > Date.now() - retentionDays * 86400000) fail('NOT_READY', `保留最近 ${retentionDays} 天的记录`);
        if (!files.length) { result.reason = marker ? '已清理，保留作业身份与幂等记录' : '没有可清理的明细'; return { result }; }
        result.bytes = files.reduce((total, file) => total + file.bytes, 0);
        result.eligible = true;
        result.reason = marker ? '上次清理未完成，可继续清理剩余文件' : '可清理旧报告与执行明细';
        result.fingerprint = hash({ jobId: entry.jobId, retentionDays, control, files });
        return { result, files, report, state, marker };
    } catch (error) { result.reason = error.message; return { result }; }
}
function preview(service, input) {
    authorize(service);
    const retentionDays = days(input.retentionDays), all = inventory(service);
    const items = all.map(entry => inspect(service, entry, all, retentionDays).result).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ...require('./service').page(items, input), retentionDays, scannedAt: new Date().toISOString(), eligibleCount: items.filter(item => item.eligible).length, eligibleBytes: items.reduce((total, item) => total + item.bytes, 0), protectedCount: items.filter(item => !item.eligible).length };
}
function writeMarker(directory, value) {
    safe(directory, true);
    const temporary = path.join(directory, '.retention-' + randomUUID() + '.tmp');
    const fd = fs.openSync(temporary, 'wx');
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.renameSync(temporary, path.join(directory, 'retention.json')); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function clean(service, input) {
    authorize(service);
    if (!Object.hasOwn(input, 'retentionDays')) fail('INVALID_REQUEST', '清理必须提交预览时的保留天数');
    const retentionDays = days(input.retentionDays);
    if (!Array.isArray(input.selection) || input.selection.length < 1 || input.selection.length > 100) fail('INVALID_REQUEST', '清理必须显式选择 1–100 项预览记录');
    const seen = new Set();
    for (const item of input.selection) {
        record(item, ['jobId', 'fingerprint']);
        if (!/^[a-f0-9]{64}$/.test(item.jobId) || !/^[a-f0-9]{64}$/.test(item.fingerprint) || seen.has(item.jobId)) fail('INVALID_REQUEST', '无效或重复的清理选择');
        seen.add(item.jobId);
    }
    const submission = acquire('submission');
    let execution;
    try {
        execution = acquire();
        const all = inventory(service);
        if (all.some(entry => entry.state && !entry.state.done)) fail('BUSY', '有作业运行或启动中，请结束后重新预览');
        const plans = input.selection.map(item => {
            const entry = all.find(candidate => candidate.jobId === item.jobId);
            if (!entry) fail('STALE_PREVIEW', '作业已变化，请重新预览');
            const plan = inspect(service, entry, all, retentionDays);
            if (!plan.result.eligible || plan.result.fingerprint !== item.fingerprint) fail('STALE_PREVIEW', '预览已过期：' + (plan.result.reason || '文件发生变化') + '，请重新预览');
            return { entry, ...plan };
        });
        const items = [];
        for (const plan of plans) {
            let removedBytes = 0, markerBytes = 0;
            try {
                if (!plan.marker) {
                    const { reportDirectory, audioResults, preview, ...summary } = plan.state;
                    const state = { ...summary };
                    if (preview) { const { files, ...info } = preview; state.preview = info; }
                    writeMarker(plan.entry.directory, { schema: SCHEMA, jobId: plan.entry.jobId, createdAt: new Date().toISOString(), finishedBefore: plan.result.finishedBefore, fingerprint: plan.result.fingerprint, reportId: plan.report, state, files: plan.files });
                    markerBytes = safe(path.join(plan.entry.directory, 'retention.json')).size;
                }
                for (const file of plan.files) {
                    const filename = file.area === 'job' ? path.join(plan.entry.directory, file.name) : path.join(REPORTS, plan.report, file.name);
                    const current = snapshot(filename);
                    if (current.sha256 !== file.sha256 || current.bytes !== file.bytes) fail('STALE_PREVIEW', '清理期间文件变化，停止此项');
                    // 绝对路径已由固定根、白名单、非链接检查及摘要再次核验；逐个删除，禁止递归删除。
                    fs.unlinkSync(filename); removedBytes += file.bytes;
                }
                if (plan.report && safe(path.join(REPORTS, plan.report), true, true)) fs.rmdirSync(path.join(REPORTS, plan.report));
                items.push({ jobId: plan.entry.jobId, freedBytes: Math.max(0, removedBytes - markerBytes), cleaned: true });
            } catch (error) { items.push({ jobId: plan.entry.jobId, freedBytes: Math.max(0, removedBytes - markerBytes), cleaned: false, error: error.message }); }
        }
        return { items, freedBytes: items.reduce((total, item) => total + item.freedBytes, 0), cleaned: items.filter(item => item.cleaned).length, failed: items.filter(item => !item.cleaned).length };
    } finally { execution?.(); submission(); }
}
module.exports = { preview, clean, expiredState, safe };
