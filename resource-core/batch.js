const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function csvCell(value) {
    let text = String(value ?? '');
    // 文件名、错误信息是外部数据，避免电子表格将其解释为公式。
    if (/^[\s]*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
}

function writeReport(directory, report) {
    fs.mkdirSync(directory, { recursive: true });
    const session = path.join(directory, new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID());
    fs.mkdirSync(session);
    fs.writeFileSync(path.join(session, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    const columns = ['path', 'resourceType', 'status', 'originalBytes', 'outputBytes', 'savedBytes', 'copied', 'backedUp', 'message'];
    const headers = ['相对路径', '模块', '状态', '原始字节', '结果字节', '节省字节', '复制原文件', '已备份', '说明'];
    const rows = [headers.map(csvCell).join(','), ...report.files.map(file => columns.map(key => csvCell(file[key])).join(','))];
    fs.writeFileSync(path.join(session, 'files.csv'), '\uFEFF' + rows.join('\r\n') + '\r\n', { flag: 'wx' });
    if (report.audioResults?.length) {
        const columns = ['path', 'operation', 'status', 'fileStatus', 'codec', 'durationSeconds', 'sampleRate', 'channels', 'inputLufs', 'outputLufs', 'inputSamplePeakDb', 'inputTruePeakDb', 'outputTruePeakDb', 'loudnessRangeLu', 'requestedGainDb', 'appliedGainDb', 'targetLufs', 'targetReached', 'limited', 'message'];
        fs.writeFileSync(path.join(session, 'audio.csv'), '\uFEFF' + [columns, ...report.audioResults.map(row => columns.map(key => row[key]))].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n', { flag: 'wx' });
    }
    return session;
}

// 独立进程执行同步编码器，主窗口通过状态文件读取进度，通过标记文件请求取消。
function runJob(request, jobDirectory, reportRoot = path.join(__dirname, 'data', 'reports')) {
    const started = Date.now(), startedAt = new Date().toISOString(), files = [];
    const statusFile = path.join(jobDirectory, 'status.json');
    let state = { phase: 'starting', done: false, processed: 0, total: 0 }, lastWrite = 0, options, task, unlock, releaseExecution;
    const publish = (update, force = false) => {
        Object.assign(state, update, { elapsedSeconds: (Date.now() - started) / 1000 });
        if (!force && Date.now() - lastWrite < 150) return;
        const temporary = path.join(jobDirectory, 'status.next');
        for (let attempt = 0; ; attempt++) {
            try {
                fs.writeFileSync(temporary, JSON.stringify(state));
                fs.renameSync(temporary, statusFile);
                break;
            } catch (error) {
                if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
                // Windows 的短暂文件占用不应把已完成的素材处理误判为失败。
                if (attempt >= 8) { if (force) throw error; return; }
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(10 * (attempt + 1), 50));
            }
        }
        lastWrite = Date.now();
    };
    const parentPid = process.ppid;
    const shouldCancel = () => fs.existsSync(path.join(jobDirectory, 'cancel')) ||
        (require.main === module && !require('./application/lock').alive(parentPid));
    const report = { schema: 'asset-toolbox.report/1', startedAt, source: request.folder, mode: request.mode, files };
    try {
    publish({}, true);
    try {
        releaseExecution = require('./application/lock').acquire();
        if (request._automationPolicy) require('./application/policy').authorize(request, request._automationPolicy);
        if (!['preview', 'process', 'resume', 'retry', 'restore', 'restore-retry', 'restore-export', 'restore-preview', 'restore-export-preview'].includes(request.mode)) throw new Error('无效任务模式');
        if (request.mode.startsWith('restore')) {
            const { restoreTask, exportBackup, previewRestoreTask, previewBackup } = require('./restore');
            const previewOnly = request.mode.endsWith('-preview');
            const common = { shouldCancel, selection: request.selection, onProgress: update => publish(update), onFile: file => files.push(file) };
            publish({ operation: previewOnly ? 'restore-preview' : 'restore' }, true);
            let summary;
            if (request.mode.startsWith('restore-export')) {
                report.source = request.backupDir; report.outputDir = request.outputDir;
                publish({ source: request.backupDir, destination: request.outputDir }, true);
                summary = previewOnly ? previewBackup(request.backupDir, request.outputDir, common) : exportBackup(request.backupDir, request.outputDir, common);
            } else {
                const { loadTask } = require('./tasks');
                task = loadTask(request.taskFile);
                if (!previewOnly) unlock = task.lock();
                report.source = task.header.backupSession; report.outputDir = task.header.source;
                publish({ task: task.info(), source: report.source, destination: report.outputDir }, true);
                summary = previewOnly ? previewRestoreTask(task, common) : restoreTask(task, { ...common, retryOnly: request.mode === 'restore-retry' });
            }
            if (previewOnly) {
                publish({ preview: summary, processed: summary.checked, total: summary.total,
                    cancelled: Boolean(summary.cancelled), exitCode: summary.cancelled ? 2 : 0 }, true);
            } else {
            report.summary = summary;
            if (request.selection !== undefined) report.selection = request.selection;
            publish({ summary, processed: summary.restored + summary.skipped + summary.failed, total: summary.total,
                cancelled: Boolean(summary.cancelled), exitCode: summary.failed ? 1 : summary.cancelled ? 2 : 0 }, true);
            }
        } else {
        const { normalizePipeline } = require('./framework/registry');
        const { scanFolder, processFolder, prepareFolder } = require('./engine');
        const { createTask, loadTask, recoverTask, snapshot, safeSource } = require('./tasks');
        const { byExtension } = require('./framework/registry');
        if (request.mode === 'resume' || request.mode === 'retry') {
            task = loadTask(request.taskFile);
            unlock = task.lock();
            if (task.restoreStarted) throw new Error('此任务已开始从备份恢复，不能继续处理或重试处理；如需重新处理，请新建任务');
            request = { ...request, folder: task.header.source, pipeline: task.header.pipeline,
                outputDir: task.header.outputDir, backupDir: task.header.backupDir };
            const current = prepareFolder(request.folder, { pipeline: request.pipeline, fileList: [],
                ...(request.outputDir ? { outputDir: request.outputDir } : {}), ...(request.backupDir ? { backupDir: request.backupDir } : {}) });
            if (current.root !== task.header.source || current.outputRoot !== task.header.outputDir || current.backupRoot !== task.header.backupDir) throw new Error('原任务文件夹的实际位置已改变，已停止恢复');
            report.recoveredFiles = recoverTask(task);
            publish({ recoveryWarnings: report.recoveredFiles.filter(file => file.warning).map(file => file.path + '：' + file.message) }, true);
        }
        options = normalizePipeline(request.pipeline);
        report.source = request.folder;
        report.pipeline = options;
        report.outputDir = request.outputDir || null; report.backupDir = request.backupDir || null;
        const common = { pipeline: options, shouldCancel, onProgress: update => publish(update) };
        if (request.outputDir) common.outputDir = request.outputDir;
        if (request.backupDir) common.backupDir = request.backupDir;
        if (request.mode === 'preview') {
            const preview = scanFolder(request.folder, common);
            publish({ preview, processed: preview.checked, total: preview.total, current: '',
                cancelled: preview.cancelled, exitCode: preview.cancelled ? 2 : 0 }, true);
        } else {
            let cancelled = false;
            if (!task || !task.scanComplete) {
                const plan = prepareFolder(request.folder, common);
                if (!task) { task = createTask(plan); unlock = task.lock(); }
                const pending = [];
                for (const filename of plan.files) {
                    if (plan.cancelled || shouldCancel()) { cancelled = true; break; }
                    const relative = path.relative(plan.root, filename);
                    publish({ phase: 'scanning', current: relative, found: pending.length });
                    let stamp;
                    try { stamp = snapshot(safeSource(plan.root, filename)); }
                    catch { stamp = { size: -1, mtimeMs: 0, ctimeMs: 0 }; }
                    pending.push({ path: relative, resourceType: byExtension.get(path.extname(filename).toLowerCase()).id, snapshot: stamp });
                }
                cancelled ||= Boolean(plan.cancelled || shouldCancel());
                if (!cancelled) task.append({ type: 'plan', files: pending });
            }
            const selected = [...task.entries.values()].filter(entry => request.mode === 'retry' ? entry.status === 'failed' : entry.status === 'pending');
            const beforeFile = (relative, filename) => {
                const entry = task.entries.get(relative), info = safeSource(task.header.source, filename);
                if (byExtension.get(path.extname(filename).toLowerCase())?.id !== entry.resourceType) throw new Error('文件对应的资源类型已改变，请恢复原类型定义');
                if (request.mode !== 'retry' && (info.size !== entry.snapshot.size || info.mtimeMs !== entry.snapshot.mtimeMs || info.ctimeMs !== entry.snapshot.ctimeMs)) {
                    throw new Error('源文件在建立任务后发生变化，未处理；确认修改后可仅重试失败项');
                }
            };
            publish({ task: task.info() }, true);
            const empty = { total: selected.length, processed: 0, skipped: 0, failed: 0, savedBytes: 0, copied: 0, backedUp: 0, backupDirectory: null, cancelled: true };
            const summary = cancelled || shouldCancel() ? empty : processFolder(request.folder, { ...common,
                fileList: selected.map(entry => entry.path), beforeFile, backupSession: task.header.backupSession, reuseBackup: true,
                replaceOutputs: new Map(selected.filter(entry => entry.ownedOutputHash).map(entry => [entry.path, entry.ownedOutputHash])),
                beforeCommit: record => task.append({ type: 'intent', path: record.path, record }),
                log: message => publish({ message }), onFile: file => { task.finish(file); files.push(file); },
            });
            report.summary = summary;
            publish({ summary, processed: summary.processed + summary.skipped + summary.failed, total: summary.total,
                cancelled: Boolean(summary.cancelled), exitCode: summary.failed ? 1 : summary.cancelled ? 2 : 0 }, true);
        }
        }
    } catch (error) {
        report.error = error.message;
        // 致命错误发生在已处理文件之后时也保留完整明细。
        publish({ error: error.message, errorCode: error.code || 'JOB_FAILED', exitCode: 1 }, true);
    }
    if (task) { report.task = task.info(); publish({ task: report.task }, true); }
    report.audioResults = files.flatMap(file => (file.steps || []).filter(step => step.metadata?.audio?.before).map(step => {
        const audio = step.metadata.audio;
        return { path: file.path, operation: step.operation, status: step.status, fileStatus: file.status,
            ...audio, inputLufs: audio.before.integratedLufs, outputLufs: audio.after?.integratedLufs ?? null,
            inputTruePeakDb: audio.before.truePeakDb, outputTruePeakDb: audio.after?.truePeakDb ?? null,
            codec: audio.before.codec, durationSeconds: audio.before.durationSeconds, sampleRate: audio.before.sampleRate, channels: audio.before.channels,
            inputSamplePeakDb: audio.before.samplePeakDb, loudnessRangeLu: audio.before.loudnessRangeLu,
            message: [step.message, ...(audio.warnings || []), ...(file.status === 'failed' ? ['该文件处理失败，测量值不代表已提交结果。'] : [])].filter(Boolean).join('；') };
    }));
    if (report.audioResults.length) publish({ audioResults: report.audioResults.slice(0, 100), audioResultCount: report.audioResults.length }, true);
    if (['process', 'resume', 'retry', 'restore', 'restore-retry', 'restore-export'].includes(request.mode)) {
        report.finishedAt = new Date().toISOString();
        report.elapsedSeconds = (Date.now() - started) / 1000;
        report.cancelled = Boolean(state.cancelled);
        try { publish({ reportDirectory: writeReport(reportRoot, report) }, true); }
        catch (error) { publish({ reportWarning: '报告保存失败：' + error.message }, true); }
    }
    publish({ phase: 'finished', done: true }, true);
    return state;
    } finally { try { if (unlock) unlock(); } finally { if (releaseExecution) releaseExecution(); } }
}

if (require.main === module) {
    let temporary;
    try {
        if (['--resume', '--retry', '--restore', '--restore-retry', '--restore-export', '--restore-preview', '--restore-export-preview'].includes(process.argv[2])) {
            const os = require('node:os');
            temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'resource-resume-'));
            const exporting = process.argv[2].startsWith('--restore-export'), tail = process.argv.slice(exporting ? 5 : 4);
            const request = { mode: process.argv[2].slice(2), taskFile: process.argv[3], backupDir: process.argv[3], outputDir: exporting ? process.argv[4] : undefined };
            if (tail.length) {
                if (tail.length !== 2 || tail[0] !== '--selection' || !tail[1] || !['restore', 'restore-retry', 'restore-export'].includes(request.mode)) throw new Error('用法：恢复命令后添加 --selection <勾选清单.json>');
                request.selection = JSON.parse(fs.readFileSync(tail[1], 'utf8').replace(/^\uFEFF/, ''));
            }
            const state = runJob(request, temporary);
            // PowerShell 5.1 的本机管道可能使用系统代码页；ASCII JSON 保留中文路径的可往返性。
            console.log(JSON.stringify(state, null, 2).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))); process.exitCode = state.exitCode;
        } else {
            const requestFile = process.argv[2];
            const request = JSON.parse(fs.readFileSync(requestFile, 'utf8').replace(/^\uFEFF/, ''));
            process.exitCode = runJob(request, path.dirname(path.resolve(requestFile))).exitCode;
        }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
    finally {
        if (temporary && path.dirname(fs.realpathSync(temporary)) === fs.realpathSync(require('node:os').tmpdir()) && path.basename(temporary).startsWith('resource-resume-')) fs.rmSync(temporary, { recursive: true, force: true });
    }
}

module.exports = { runJob, writeReport };
