// 冲突 FIFO：持久预约和 worker 独立占用共同决定资源与容量，原持有者派发。
const fs = require('node:fs');
const path = require('node:path');
const { acquire, acquireGate, readers, alive } = require('./lock');
const { validate, schedule } = require('./resources');
const { safe } = require('./storage');
const { JOB } = require('./contract');
const read = filename => { safe(filename); return JSON.parse(fs.readFileSync(filename, 'utf8')); };
function inventory(root, leases = readers(false)) {
    if (!safe(root, true, true)) {
        if (leases.length) throw new Error('活跃执行占用的作业目录缺失，停止调度');
        return [];
    }
    const items = fs.readdirSync(root).filter(id => /^[a-f0-9]{64}$/.test(id)).map(id => {
        const directory = path.join(root, id), meta = read(path.join(directory, 'job.json'));
        if (meta.schema !== JOB || meta.id !== id || !Number.isSafeInteger(meta.sequence) || meta.sequence < 1) throw Object.assign(Error('队列作业格式不支持'), { code: 'UNSUPPORTED_VERSION' });
        validate(meta.resources);
        const optional = name => safe(path.join(directory, name), false, true) ? read(path.join(directory, name)) : null;
        const state = optional('status.json'), worker = optional('worker.json'), exit = optional('exit.json');
        const claim = optional('dispatch.json');
        if (claim && (claim.schema !== 'asset-toolbox.dispatch/3' || claim.sequence !== meta.sequence || claim.owner !== meta.owner)) throw Object.assign(Error('启动声明格式不支持'), { code: 'UNSUPPORTED_VERSION' });
        const dispatched = Boolean(claim);
        if (claim && (!Number.isInteger(claim.slot) || claim.slot < 1 || claim.slot > require('./scheduling').MAX)) throw new Error('启动槽位声明无效');
        const lease = leases.find(item => item.jobId === id);
        if (lease && claim?.slot !== lease.slot) throw new Error('启动预约与执行占用槽位不一致');
        const running = leases.some(lease => lease.jobId === id) || (!exit && (worker ? alive(worker.pid) || alive(meta.ownerPid) : dispatched && alive(meta.ownerPid)));
        const pending = running || (!state?.done && !exit && !dispatched && alive(meta.ownerPid));
        return { ...meta, slot: claim?.slot, directory, dispatched, running, pending };
    }).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
    // 父进程在 spawn 后、worker.json 落盘前崩溃时仍保护已经登记的子进程占用。
    return items.concat(leases.filter(lease => !items.some(item => item.id === lease.jobId)).map(lease => ({ id: lease.jobId, sequence: 0, slot: lease.slot, resources: lease.resources, running: true, pending: true })));
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
        let release, execution;
        try {
            release = acquire('submission');
            execution = acquireGate();
            const items = inventory(this.service.directory, readers());
            this.service.queueError = '';
            for (const item of items) if (item.owner === this.service.owner && !item.pending) this.service.owned.delete(item.id);
            for (const item of schedule(items).selected) {
                if (item.owner === this.service.owner) this.service.startQueued(item);
            }
        } catch (error) {
            if (error.code !== 'BUSY') this.service.queueError = error.message;
        } finally { execution?.(); release?.(); if (this.service.owned.size) this.wake(); }
    }
    stop() { this.closed = true; clearTimeout(this.timer); this.timer = null; }
}
module.exports = { Queue, inventory };
