const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { relativeFile, digest, backupEntries, validateRestoreSelection } = require('./tasks');

const within = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};

// 从卷根开始检查，连同不存在文件的祖先目录一起拒绝链接/目录联接。
function inspect(filename, missing = false) {
    filename = path.resolve(filename);
    let current = path.parse(filename).root, result = fs.lstatSync(current);
    const parts = path.relative(current, filename).split(path.sep).filter(Boolean);
    for (let index = 0; index < parts.length; index++) {
        current = path.join(current, parts[index]);
        try { result = fs.lstatSync(current); }
        catch (error) { if (missing && error.code === 'ENOENT') return null; throw error; }
        if (result.isSymbolicLink()) throw new Error('恢复路径包含链接或目录联接：' + current);
        if (index < parts.length - 1 && !result.isDirectory()) throw new Error('恢复路径的父级不是文件夹：' + current);
    }
    return result;
}
function readFile(filename, missing = false) {
    const stat = inspect(filename, missing);
    if (!stat) return null;
    if (!stat.isFile()) throw new Error('恢复路径不是普通文件：' + filename);
    return { data: fs.readFileSync(filename), mode: stat.mode };
}
function ensureDirectory(directory) {
    const stat = inspect(directory, true);
    if (stat) { if (!stat.isDirectory()) throw new Error('恢复目标不是文件夹：' + directory); return; }
    ensureDirectory(path.dirname(directory));
    fs.mkdirSync(directory);
    inspect(directory);
}
function validateRoots(backup, target, exportOnly, allowMissingBackup = false) {
    if (typeof backup !== 'string' || !backup.trim() || typeof target !== 'string' || !target.trim()) throw new Error('请选择备份文件夹和恢复目标文件夹');
    backup = path.resolve(backup); target = path.resolve(target);
    const backupInfo = inspect(backup, allowMissingBackup);
    if (backupInfo && !backupInfo.isDirectory()) throw new Error('备份路径不是文件夹');
    const targetInfo = inspect(target, true);
    if (targetInfo && !targetInfo.isDirectory()) throw new Error('恢复目标不是文件夹');
    if (within(backup, target) || (exportOnly && within(target, backup))) throw new Error('备份与导出目标不能相同或互相包含');
    return { backup, target };
}

function createMissingFile(temporary, target, original) {
    try { fs.linkSync(temporary, target); return; }
    catch (error) {
        // FAT/exFAT 及部分共享盘不支持硬链接，退回排他创建；绝不覆盖同名文件。
        if (!['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM', 'EXDEV'].includes(error.code)) throw error;
    }
    inspect(path.dirname(target));
    const fd = fs.openSync(target, 'wx', original.mode), identity = fs.fstatSync(fd);
    try { fs.writeFileSync(fd, original.data); fs.fsyncSync(fd); }
    catch (error) {
        fs.closeSync(fd);
        const current = inspect(target, true);
        if (current?.isFile() && current.dev === identity.dev && current.ino === identity.ino) fs.unlinkSync(target);
        throw error;
    }
    fs.closeSync(fd);
}

function assessFile(backup, target, hashes) {
    let original;
    try { original = readFile(backup); }
    catch (error) {
        if (error.code === 'ENOENT') throw new Error('备份文件不存在，请检查备份是否被移动或删除：' + backup);
        throw error;
    }
    if (hashes && (!/^[a-f0-9]{64}$/.test(hashes.sourceHash || '') || !/^[a-f0-9]{64}$/.test(hashes.expectedHash || ''))) throw new Error('任务缺少有效的原文件或压缩结果校验信息');
    if (hashes && digest(original.data) !== hashes.sourceHash) throw new Error('备份内容与原文件校验值不符，未恢复');
    const current = readFile(target, true);
    const backupHash = digest(original.data), targetHash = current ? digest(current.data) : null;
    if (current && current.data.equals(original.data)) return { original, current, backupHash, targetHash, state: 'restored' };
    if (current && (!hashes || digest(current.data) !== hashes.expectedHash)) throw new Error('目标文件已被修改或不属于本次压缩结果，已保留；可将备份导出到其他文件夹');
    return { original, current, backupHash, targetHash, state: 'recoverable' };
}

function restoreFile(backup, target, hashes, selection) {
    const checked = assessFile(backup, target, hashes), { original, current } = checked;
    if (selection && (selection.backupHash !== checked.backupHash || (selection.targetHash !== checked.targetHash && checked.state !== 'restored'))) throw new Error('文件自预览后发生变化，请刷新预览后重新选择');
    if (checked.state === 'restored') return { status: 'already-original', originalBytes: current.data.length, outputBytes: original.data.length, message: '目标已经与备份相同，未重复写入' };
    ensureDirectory(path.dirname(target));
    const temporary = path.join(path.dirname(target), '.resource-restore-' + randomUUID() + '.tmp');
    let created = false;
    try {
        const fd = fs.openSync(temporary, 'wx', original.mode);
        created = true;
        try { fs.writeFileSync(fd, original.data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        // 写入前再次检查双方，避免恢复过程中发生的修改被覆盖。
        if (!readFile(backup).data.equals(original.data)) throw new Error('备份在恢复期间发生变化，未替换目标');
        const latest = readFile(target, true);
        if ((current === null) !== (latest === null) || (current && !current.data.equals(latest.data))) throw new Error('目标在恢复期间发生变化，未替换');
        if (current) fs.renameSync(temporary, target);
        else {
            // 原子创建且不覆盖竞争期间出现的同名文件；两者位于同一卷。
            createMissingFile(temporary, target, original);
        }
        return { status: 'restored', originalBytes: current?.data.length || 0, outputBytes: original.data.length, message: current ? '已从备份恢复原文件' : '已补回缺失的原文件' };
    } finally { if (created && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function processFiles(entries, roots, options, getHashes) {
    const summary = { total: entries.length, restored: 0, skipped: 0, failed: 0, restoredBytes: 0 };
    const progress = (entry = null) => options.onProgress?.({ phase: 'restoring', processed: summary.restored + summary.skipped + summary.failed, total: summary.total, current: entry?.path || '' });
    for (const entry of entries) {
        if (options.shouldCancel?.()) { summary.cancelled = true; break; }
        progress(entry);
        const record = { path: entry.path, module: entry.module || '', status: 'failed', message: '' };
        try {
            const backup = relativeFile(roots.backup, entry.path), target = relativeFile(roots.target, entry.path);
            if (within(roots.backup, target)) throw new Error('恢复目标位于备份文件夹中');
            Object.assign(record, restoreFile(backup, target, getHashes(entry), entry.selection));
            if (record.status === 'restored') { summary.restored++; summary.restoredBytes += record.outputBytes; }
            else summary.skipped++;
        } catch (error) { summary.failed++; record.message = error.message; }
        // 检查点写入失败必须停止后续文件；已提交但未记账的文件下次按内容识别。
        options.onFile?.(record);
        progress(entry);
    }
    progress();
    return summary;
}

function restoreTask(task, options = {}) {
    const all = backupEntries(task);
    if (!all.length) throw new Error('此任务没有可恢复的覆盖备份；旧备份可使用“选择备份导出”');
    const roots = validateRoots(task.header.backupSession, task.header.source, false);
    const explicit = options.selection !== undefined;
    const selection = explicit ? validateRestoreSelection(roots.target, options.selection) : task.restoreSelection;
    const byPath = new Map(all.map(entry => [entry.path, entry]));
    if (selection?.some(file => !byPath.has(file.path))) throw new Error('恢复勾选清单包含备份范围外的文件');
    let selected = selection === null ? all : selection.map(file => ({ ...byPath.get(file.path), selection: !explicit && options.retryOnly ? undefined : file }));
    selected = selected.filter(entry => {
        if (['restored', 'already-original'].includes(entry.restoreRecord?.status)) return false;
        return options.retryOnly ? entry.restoreRecord?.status === 'failed' : explicit || !entry.restoreRecord;
    });
    if (selected.length && !options.shouldCancel?.()) {
        if (!task.restoreStarted) task.append({ type: 'restore-start', startedAt: new Date().toISOString() });
        if (explicit) task.append({ type: 'restore-selection', files: selection });
    }
    return processFiles(selected, roots, { ...options, onFile: record => {
        task.append({ type: 'restore-result', path: record.path, record });
        options.onFile?.(record);
    } }, entry => entry.backupRecord);
}

// 无任务清单的旧备份只能导出；任何不同内容的已有文件均保留。
function collectBackup(roots, options) {
    const files = [];
    let cancelled = false;
    const walk = directory => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            if (options.shouldCancel?.()) { cancelled = true; return; }
            const filename = path.join(directory, entry.name), relative = path.relative(roots.backup, filename);
            if (entry.isDirectory() && !entry.isSymbolicLink()) { inspect(filename); walk(filename); }
            else files.push({ path: relative }); // 链接作为失败项记录，不跟随它。
            options.onProgress?.({ phase: 'scanning', found: files.length, current: relative });
            if (cancelled) return;
        }
    };
    walk(roots.backup);
    return { files, cancelled: cancelled || Boolean(options.shouldCancel?.()) };
}

function exportBackup(backupDirectory, targetDirectory, options = {}) {
    const roots = validateRoots(backupDirectory, targetDirectory, true);
    const selected = options.selection === undefined ? null : validateRestoreSelection(roots.target, options.selection);
    const { files, cancelled } = selected === null ? collectBackup(roots, options) : { files: selected.map(file => ({ path: file.path, selection: file })), cancelled: false };
    if (cancelled || options.shouldCancel?.()) return { total: files.length, restored: 0, skipped: 0, failed: 0, restoredBytes: 0, cancelled: true };
    return processFiles(files, roots, options, () => null);
}

function previewFiles(entries, roots, options, getHashes) {
    const preview = { source: roots.backup, destination: roots.target, total: entries.length, checked: 0, recoverable: 0, restored: 0, conflict: 0, files: [], cancelled: false };
    for (const entry of entries) {
        if (options.shouldCancel?.()) { preview.cancelled = true; break; }
        options.onProgress?.({ phase: 'checking', processed: preview.checked, total: preview.total, current: entry.path });
        const file = { path: entry.path, module: entry.module || '', state: 'conflict', selectable: false,
            queue: entry.restoreRecord?.status === 'failed' ? 'failed' : entry.restoreRecord ? 'completed' : 'pending',
            inLastSelection: entry.inLastSelection !== false, backupBytes: null, currentBytes: null, reason: '' };
        try {
            const target = relativeFile(roots.target, entry.path);
            if (within(roots.backup, target)) throw new Error('恢复目标位于备份文件夹中');
            const checked = assessFile(relativeFile(roots.backup, entry.path), target, getHashes(entry));
            if (file.queue === 'completed' && checked.state !== 'restored') throw new Error('此文件已恢复过，之后又发生变化；保留当前文件，可导出备份另行核对');
            Object.assign(file, { state: checked.state, selectable: checked.state === 'recoverable', backupHash: checked.backupHash,
                targetHash: checked.targetHash, backupBytes: checked.original.data.length, currentBytes: checked.current?.data.length ?? null,
                reason: checked.state === 'restored' ? '当前内容与备份一致，无需重复写入' : checked.current ? '备份完整，当前内容匹配本次压缩结果' : '目标缺失，可补回原文件' });
        } catch (error) { file.reason = error.message; }
        preview[file.state]++; preview.checked++; preview.files.push(file);
    }
    options.onProgress?.({ phase: 'checking', processed: preview.checked, total: preview.total, current: '' });
    return preview;
}

function previewRestoreTask(task, options = {}) {
    const roots = validateRoots(task.header.backupSession, task.header.source, false, true);
    const scope = task.restoreSelection === null ? null : new Set(task.restoreSelection.map(file => file.path));
    return previewFiles(backupEntries(task).map(entry => ({ ...entry, inLastSelection: scope === null || scope.has(entry.path) })), roots, options, entry => entry.backupRecord);
}

function previewBackup(backupDirectory, targetDirectory, options = {}) {
    const roots = validateRoots(backupDirectory, targetDirectory, true), collected = collectBackup(roots, options);
    if (collected.cancelled) return { source: roots.backup, destination: roots.target, total: collected.files.length, checked: 0, recoverable: 0, restored: 0, conflict: 0, files: [], cancelled: true };
    return previewFiles(collected.files, roots, options, () => null);
}

module.exports = { restoreTask, exportBackup, previewRestoreTask, previewBackup };
