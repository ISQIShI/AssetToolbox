// FIFO 的序号与启动声明持久化；提交锁是调度选主边界，执行锁仍由 worker 持有。
const fs = require('node:fs');
const path = require('node:path');
const { acquire, alive } = require('./lock');
const { safe } = require('./storage');
const { JOB } = require('./contract');
const read = filename => { safe(filename); return JSON.parse(fs.readFileSync(filename, 'utf8')); };
function inventory(root) {
    if (!safe(root, true, true)) return [];
    return fs.readdirSync(root).filter(id => /^[a-f0-9]{64}$/.test(id)).map(id => {
        const directory = path.join(root, id), meta = read(path.join(directory, 'job.json'));
        if (meta.schema !== JOB || meta.id !== id || !Number.isSafeInteger(meta.sequence) || meta.sequence < 1) throw Object.assign(Error('队列作业格式不支持'), { code: 'UNSUPPORTED_VERSION' });
        const optional = name => safe(path.join(directory, name), false, true) ? read(path.join(directory, name)) : null;
        const state = optional('status.json'), worker = optional('worker.json'), exit = optional('exit.json');
        const claim = optional('dispatch.json');
        if (claim && (claim.schema !== 'asset-toolbox.dispatch/1' || claim.sequence !== meta.sequence || claim.owner !== meta.owner)) throw Object.assign(Error('启动声明格式不支持'), { code: 'UNSUPPORTED_VERSION' });
        const dispatched = Boolean(claim);
        const running = !exit && (worker ? alive(worker.pid) || alive(meta.ownerPid) : dispatched && alive(meta.ownerPid));
        const pending = running || (!state?.done && !exit && !dispatched && alive(meta.ownerPid));
        return { ...meta, directory, dispatched, running, pending };
    }).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}
class Queue {
    constructor(service) { this.service = service; this.timer = null; this.closed = false; }
    wake() {
        if (this.closed || this.timer) return;
        this.timer = setTimeout(() => { this.timer = null; this.tick(); }, 100);
        this.timer.unref();
    }
    tick() {
        if (this.closed) return;
        let release;
        try {
            release = acquire('submission');
            const items = inventory(this.service.directory), pending = items.filter(item => item.pending);
            this.service.queueError = '';
            for (const item of items) if (item.owner === this.service.owner && !item.pending) this.service.owned.delete(item.id);
            const first = pending[0];
            if (!first || pending.some(item => item.running) || first.owner !== this.service.owner) return;
            // 维护或崩溃前启动的工作进程仍可能占执行锁，等待而不是让新 worker 失败。
            const execution = acquire(); execution();
            this.service.startQueued(first);
        } catch (error) {
            if (error.code !== 'BUSY') this.service.queueError = error.message;
        } finally { release?.(); if (this.service.owned.size) this.wake(); }
    }
    stop() { this.closed = true; clearTimeout(this.timer); this.timer = null; }
}
module.exports = { Queue, inventory };
