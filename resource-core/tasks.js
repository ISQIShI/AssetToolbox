const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

const TASK_ROOT = path.join(__dirname, 'data', 'tasks');
const digest = data => createHash('sha256').update(data).digest('hex');
function relativeFile(root, relative) {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /[:\0]/.test(relative) ||
        relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..')) throw new Error('任务文件路径无效：' + relative);
    return path.join(root, relative);
}
function safeSource(root, filename) {
    const relative = path.relative(root, filename);
    relativeFile(root, relative);
    let current = root;
    if (fs.realpathSync(root) !== root) throw new Error('源文件夹的实际位置已改变');
    for (const part of relative.split(path.sep)) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink()) throw new Error('源路径已变为链接，已停止处理：' + relative);
    }
    const info = fs.statSync(filename);
    if (!info.isFile()) throw new Error('源路径不是文件：' + relative);
    return info;
}
function snapshot(info) { return { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs }; }
function validateRestoreSelection(root, selection) {
    if (!Array.isArray(selection)) throw new Error('恢复勾选清单必须为数组');
    const seen = new Set();
    return selection.map(item => {
        const filename = relativeFile(root, item?.path), relative = path.relative(root, filename);
        const key = process.platform === 'win32' ? relative.toLowerCase() : relative;
        if (seen.has(key)) throw new Error('恢复勾选清单包含重复路径：' + relative);
        seen.add(key);
        if (!/^[a-f0-9]{64}$/.test(item.backupHash || '') || (item.targetHash !== null && !/^[a-f0-9]{64}$/.test(item.targetHash || ''))) throw new Error('恢复勾选清单缺少预览校验信息：' + relative);
        return { path: relative, backupHash: item.backupHash, targetHash: item.targetHash };
    });
}
function writeDurable(filename, value, flag = 'wx') {
    const fd = fs.openSync(filename, flag);
    try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function processAlive(pid) {
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
}
function validateHeader(header) {
    if (!header || header.schema !== 'asset-toolbox.task/1' || typeof header.id !== 'string' || typeof header.source !== 'string' || !path.isAbsolute(header.source) ||
        !Array.isArray(header.pipeline) || header.pipeline.some(step => !step || typeof step.id !== 'string' || !step.versions)) throw new Error('任务断点格式无效或版本不支持');
    for (const key of ['outputDir', 'backupDir']) if (header[key] !== null && (typeof header[key] !== 'string' || !path.isAbsolute(header[key]))) throw new Error('任务路径无效：' + key);
    if (header.outputDir && header.backupDir) throw new Error('任务保存方式冲突');
    if (header.backupDir && (typeof header.backupSession !== 'string' || path.dirname(header.backupSession) !== header.backupDir || !path.basename(header.backupSession).startsWith('backup-'))) throw new Error('任务备份位置无效');
}
function createTask(plan, root = TASK_ROOT) {
    fs.mkdirSync(root, { recursive: true });
    const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID();
    const directory = path.join(root, id); fs.mkdirSync(directory);
    const header = { schema: 'asset-toolbox.task/1', id, createdAt: new Date().toISOString(), source: plan.root,
        outputDir: plan.outputRoot, backupDir: plan.backupRoot, pipeline: plan.pipeline,
        backupSession: plan.backupRoot ? path.join(plan.backupRoot, 'backup-' + id) : null };
    const taskFile = path.join(directory, 'task.json');
    writeDurable(taskFile, JSON.stringify(header, null, 2));
    return loadTask(taskFile);
}
function loadTask(taskFile) {
    taskFile = fs.realpathSync(taskFile);
    if (path.basename(taskFile) !== 'task.json') throw new Error('请选择 tasks 目录中的 task.json 断点文件');
    const header = JSON.parse(fs.readFileSync(taskFile, 'utf8').replace(/^\uFEFF/, ''));
    validateHeader(header);
    const entries = new Map(), journal = path.join(path.dirname(taskFile), 'events.jsonl');
    let scanComplete = false, restoreStarted = false, restoreSelection = null, validLength = 0;
    const apply = event => {
        if (event.type === 'plan') {
            if (scanComplete || !Array.isArray(event.files)) throw new Error('任务扫描记录无效');
            for (const file of event.files) {
                relativeFile(header.source, file.path);
                if (entries.has(file.path) || typeof file.resourceType !== 'string' || !file.snapshot || !Number.isFinite(file.snapshot.size) || !Number.isFinite(file.snapshot.mtimeMs)) throw new Error('任务文件清单无效');
                entries.set(file.path, { ...file, status: 'pending', ownedOutputHash: null });
            }
            scanComplete = true;
        } else if (event.type === 'intent' || event.type === 'result') {
            const entry = entries.get(event.path);
            if (!entry || !event.record || event.record.path !== event.path) throw new Error('任务处理记录与文件清单不匹配');
            if (event.type === 'intent') {
                entry.intent = event.record; entry.status = 'running';
                // 提交意图中的哈希用于崩溃后判断文件是否已经完成替换。
                if (event.record.backedUp) entry.backupRecord = event.record;
            }
            else {
                if (!['processed', 'skipped', 'failed', 'pending'].includes(event.record.status)) throw new Error('任务处理状态无效');
                entry.record = event.record; entry.status = event.record.status; delete entry.intent;
                if (event.record.outputHash) entry.ownedOutputHash = event.record.outputHash;
            }
        } else if (event.type === 'restore-start') {
            if (!header.backupSession || header.outputDir) throw new Error('任务没有覆盖备份');
            restoreStarted = true;
        } else if (event.type === 'restore-selection') {
            if (!restoreStarted) throw new Error('恢复尚未开始');
            const selected = validateRestoreSelection(header.source, event.files);
            if (selected.some(file => !entries.has(file.path))) throw new Error('恢复勾选清单包含任务外文件');
            restoreSelection = selected;
        } else if (event.type === 'restore-result') {
            const entry = entries.get(event.path);
            if (!restoreStarted || !entry || event.record?.path !== event.path ||
                !['restored', 'already-original', 'failed'].includes(event.record.status)) throw new Error('备份恢复记录无效');
            entry.restoreRecord = event.record;
        } else throw new Error('未知任务记录');
    };
    if (fs.existsSync(journal)) {
        if (fs.lstatSync(journal).isSymbolicLink()) throw new Error('任务日志不能为链接');
        const bytes = fs.readFileSync(journal);
        // 只接受完整、已换行的记录；突然退出留下的尾部在持锁恢复时截断。
        validLength = bytes.lastIndexOf(10) + 1;
        for (const line of bytes.subarray(0, validLength).toString('utf8').split('\n').filter(Boolean)) apply(JSON.parse(line));
    }
    let locked = false;
    const task = { header, taskFile, entries, get scanComplete() { return scanComplete; }, get restoreStarted() { return restoreStarted; }, get restoreSelection() { return restoreSelection; }, get journalLength() { return validLength; },
        lock() {
            const filename = path.join(path.dirname(taskFile), 'task.lock'), token = randomUUID();
            const claim = path.join(path.dirname(taskFile), `claim-${process.pid}-${token}.lock`);
            writeDurable(claim, '');
            try {
            // 所有取锁者先登记；同时进入者看到其他活跃声明就退出。
            // 这样死进程留下的锁只有一个恢复者能移除，不会误删刚被另一进程取得的新锁。
            for (const name of fs.readdirSync(path.dirname(taskFile))) {
                const match = /^claim-(\d+)-[a-f0-9-]+\.lock$/.exec(name);
                if (match && name !== path.basename(claim) && processAlive(Number(match[1]))) throw new Error('另一窗口正在取得任务锁，请稍后重试');
            }
            try { writeDurable(filename, JSON.stringify({ pid: process.pid, token })); }
            catch (error) {
                if (error.code !== 'EEXIST') throw error;
                const before = fs.readFileSync(filename, 'utf8'), previous = JSON.parse(before);
                if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw new Error('任务锁无效，请检查 task.lock');
                if (processAlive(previous.pid)) throw new Error('此任务正在运行，请等待结束后再继续或重试');
                if (fs.readFileSync(filename, 'utf8') !== before) throw new Error('任务锁已改变，请重试');
                fs.unlinkSync(filename);
                writeDurable(filename, JSON.stringify({ pid: process.pid, token }));
            }
            locked = true;
            try {
                // 读取和取锁之间可能有另一个运行刚结束；持锁后重新加载，不使用旧快照截断日志。
                const fresh = loadTask(taskFile);
                if (JSON.stringify(fresh.header) !== JSON.stringify(header)) throw new Error('任务定义已改变，请重新选择任务');
                entries.clear(); for (const [key, value] of fresh.entries) entries.set(key, value);
                scanComplete = fresh.scanComplete; restoreStarted = fresh.restoreStarted; restoreSelection = fresh.restoreSelection; validLength = fresh.journalLength;
                if (fs.existsSync(journal)) fs.truncateSync(journal, validLength);
            } catch (error) { fs.unlinkSync(filename); locked = false; throw error; }
            return () => {
                if (fs.existsSync(filename) && JSON.parse(fs.readFileSync(filename, 'utf8')).token === token) fs.unlinkSync(filename);
                locked = false;
            };
            } finally { fs.unlinkSync(claim); }
        },
        append(event) {
            if (!locked) throw new Error('未持有任务锁');
            writeDurable(journal, JSON.stringify(event) + '\n', 'a');
            apply(event);
        },
        finish(record) { task.append({ type: 'result', path: record.path, record }); },
        info() {
            const values = [...entries.values()], completed = values.filter(file => ['processed', 'skipped'].includes(file.status)).length;
            const failed = values.filter(file => file.status === 'failed').length;
            const pending = values.length - completed - failed;
            const backups = backupEntries(task), restored = backups.filter(file => ['restored', 'already-original'].includes(file.restoreRecord?.status)).length;
            const restoreFailed = backups.filter(file => file.restoreRecord?.status === 'failed').length;
            const restorePending = backups.length - restored - restoreFailed;
            const scope = restoreSelection === null ? backups : restoreSelection.map(file => entries.get(file.path));
            const selectedPending = scope.filter(file => !file.restoreRecord).length;
            const selectedFailed = scope.filter(file => file.restoreRecord?.status === 'failed').length;
            return { taskFile, id: header.id, createdAt: header.createdAt, source: header.source, outputDir: header.outputDir, backupDir: header.backupDir,
                backupSession: header.backupSession, backupCount: backups.length, restored, restoreFailed, restorePending, restoreStarted,
                restoreSelectedTotal: scope.length, restoreSelectedPending: selectedPending, restoreSelectedFailed: selectedFailed,
                canRestore: backups.length > restored, canContinueRestore: selectedPending > 0, canRetryRestore: selectedFailed > 0,
                total: values.length, completed, failed, pending, scanComplete,
                canResume: !restoreStarted && (!scanComplete || pending > 0), canRetry: !restoreStarted && failed > 0 };
        },
    };
    return task;
}

function backupEntries(task) {
    if (!task.header.backupSession || task.header.outputDir) return [];
    return [...task.entries.values()].filter(entry => entry.backupRecord &&
        (entry.record?.backedUp || entry.intent?.backedUp || entry.status === 'processed' || entry.restoreRecord));
}

// 有写入意图却没有完成记录：核对磁盘结果，防止退出窗口内已提交的文件被重复处理。
function recoverTask(task) {
    const { header } = task;
    const recovered = [];
    const hashFile = filename => {
        try {
            let current = filename;
            while (true) {
                if (fs.lstatSync(current).isSymbolicLink()) throw new Error('恢复路径包含链接');
                const parent = path.dirname(current); if (parent === current) break; current = parent;
            }
            return digest(fs.readFileSync(filename));
        } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    };
    for (const entry of task.entries.values()) {
        if (!entry.intent) continue;
        const intent = entry.intent, target = relativeFile(header.outputDir || header.source, entry.path);
        let record;
        try {
            const current = hashFile(target);
            if (current === intent.expectedHash) {
                record = { ...intent, message: intent.message || '从已提交的磁盘结果恢复完成状态' };
                if (intent.backedUp) {
                    const backup = relativeFile(header.backupSession, entry.path);
                    try {
                        if (hashFile(backup) !== intent.sourceHash) throw new Error('备份不匹配或已丢失');
                    } catch (error) {
                        record.backedUp = false; record.warning = true;
                        record.message = '处理结果已提交，不会重复处理；原备份需要检查：' + error.message;
                    }
                }
                // 未确认完成的失败副本不能据相同内容取得所有权；后续重试仍保护已有文件。
                if (record.status === 'failed' && !entry.ownedOutputHash) { record.outputHash = null; record.copied = false; }
            } else if ((!header.outputDir && current === intent.sourceHash) || (header.outputDir && (current === null || current === entry.ownedOutputHash))) {
                // 未提交时不自动重试编码，保留为失败项，由“仅重试失败”明确重新尝试。
                record = { path: entry.path, resourceType: entry.resourceType, status: 'failed', message: '上次进程在提交前中断，请重试此项' };
            } else throw new Error('上次中断的文件与预期结果不一致，已保留现有文件');
        } catch (error) { record = { path: entry.path, resourceType: entry.resourceType, status: 'failed', message: error.message }; }
        task.finish(record);
        recovered.push(record);
    }
    return recovered;
}

function listTasks(root = TASK_ROOT) {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
        const taskFile = path.join(root, entry.name, 'task.json');
        try { return loadTask(taskFile).info(); }
        catch (error) { return { taskFile, id: entry.name, error: error.message, canResume: false, canRetry: false }; }
    }).sort((a, b) => b.id.localeCompare(a.id));
}
if (require.main === module) {
    try {
        if (process.argv[2] !== '--list') throw new Error('用法：node tasks.js --list');
        console.log(JSON.stringify(listTasks()).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { TASK_ROOT, createTask, loadTask, recoverTask, listTasks, relativeFile, safeSource, snapshot, digest, backupEntries, validateRestoreSelection };
