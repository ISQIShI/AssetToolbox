const path = require('node:path');
const { canonical, within, fail } = require('./policy');
const SCHEMA = 'asset-toolbox.resources/1';
const LIMIT = 2;
const keyPath = value => { const resolved = canonical(value); return process.platform === 'win32' ? resolved.toLowerCase() : resolved; };

// 目录占用包含后代及任务目录；提供方使用精确标识。整个集合一次授予，不逐个等待锁。
function plan(request) {
    const entries = [];
    const add = (kind, key, access) => entries.push({ kind, key, access });
    const directory = (value, access, internal = false) => {
        if (!value) return;
        const key = keyPath(value), core = keyPath(path.join(__dirname, '..'));
        if (!internal && (within(core, key) || within(key, core))) fail('PATH_FORBIDDEN', '素材、输出和备份目录不能包含核心代码或作业存储');
        add('path', key, access);
    };
    if (request.mode === 'dependency-install') {
        add('provider', request.providerId, 'write');
        directory(path.join(__dirname, '..', 'data', 'dependencies', request.providerId), 'write', true);
    } else if (request.mode.startsWith('restore-export')) {
        directory(request.backupDir, 'read');
        directory(request.outputDir, request.mode.endsWith('-preview') ? 'read' : 'write');
    } else {
        let input = request;
        if (request.taskFile) {
            const { header } = require('../tasks').loadTask(request.taskFile);
            input = { ...request, folder: header.source, pipeline: header.pipeline, outputDir: header.outputDir, backupDir: header.backupDir, backupSession: header.backupSession };
            directory(path.dirname(request.taskFile), request.mode === 'restore-preview' ? 'read' : 'write', true);
        }
        if (request.mode.startsWith('restore')) {
            directory(input.folder, request.mode === 'restore-preview' ? 'read' : 'write');
            directory(input.backupSession, 'read');
        } else {
            const enabled = input.pipeline.filter(step => step.enabled);
            const observation = enabled.length > 0 && enabled.every(step => require('../framework/registry').operations.get(step.operation)?.resultPolicy === 'observe');
            const readOnly = request.mode === 'preview' || observation;
            directory(input.folder, readOnly || input.outputDir ? 'read' : 'write');
            // 预览也会检查保存目录；恢复/续跑的任务目录单独锁定。
            if (!observation) {
                directory(input.outputDir, readOnly ? 'read' : 'write');
                directory(input.backupDir, readOnly ? 'read' : 'write');
            }
            for (const step of enabled) add('provider', step.provider, 'read');
        }
    }
    const unique = new Map();
    for (const entry of entries) {
        const key = JSON.stringify([entry.kind, entry.key]), previous = unique.get(key);
        if (!previous || entry.access === 'write') unique.set(key, entry);
    }
    return validate({ schema: SCHEMA, entries: [...unique.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) });
}
function validate(value) {
    if (value?.schema !== SCHEMA || !Array.isArray(value.entries) || !value.entries.length || value.entries.some(entry =>
        !['path', 'provider'].includes(entry?.kind) || !['read', 'write'].includes(entry.access) || typeof entry.key !== 'string' || !entry.key ||
        (entry.kind === 'path' && !path.isAbsolute(entry.key)))) fail('UNSUPPORTED_VERSION', '资源占用声明格式不支持');
    return value;
}
function conflicts(left, right) {
    validate(left); validate(right);
    return left.entries.some(a => right.entries.some(b => a.kind === b.kind && (a.access === 'write' || b.access === 'write') &&
        (a.kind === 'path' ? within(a.key, b.key) || within(b.key, a.key) : a.key === b.key)));
}
// 按序选取；较早的等待项也保留冲突优先权，不允许连续读者饿死写者。
function schedule(items) {
    const active = items.filter(item => item.running), waiting = items.filter(item => item.pending && !item.running);
    const selected = [], reasons = new Map();
    for (let i = 0; i < waiting.length; i++) {
        const item = waiting[i];
        if (active.some(other => conflicts(item.resources, other.resources))) reasons.set(item.id, 'resource-conflict');
        else if (waiting.slice(0, i).some(other => conflicts(item.resources, other.resources))) reasons.set(item.id, 'earlier-conflict');
        else if (active.length + selected.length >= LIMIT) reasons.set(item.id, 'capacity');
        else { selected.push(item); reasons.set(item.id, 'owner-dispatch'); }
    }
    return { selected, reasons, runningCount: active.length };
}
module.exports = { plan, validate, conflicts, schedule, LIMIT };
