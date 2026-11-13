const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fail } = require('./policy');
const { acquire } = require('./lock');
const { safe } = require('./storage');
const filename = path.join(__dirname, '..', 'data', 'scheduling.json');
const MAX = 8;
function recommendation() {
    const os = require('node:os'), availableProcessors = os.availableParallelism();
    // 编码器内部也会并行，建议预算保守分配，不能当作硬件性能测量或内存配额。
    return { availableProcessors, recommendedConcurrent: Math.min(4, Math.max(1, Math.floor(availableProcessors / 4))) };
}
function read() {
    if (!safe(filename, false, true)) return { schema: 'asset-toolbox.scheduling/1', maxConcurrent: 2 };
    const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (value.schema !== 'asset-toolbox.scheduling/1' || Object.keys(value).some(key => !['schema', 'maxConcurrent'].includes(key))) fail('UNSUPPORTED_VERSION', '调度配置格式不支持');
    validateLimit(value.maxConcurrent);
    return value;
}
function validateLimit(value) {
    if (!Number.isInteger(value) || value < 1 || value > MAX) fail('INVALID_REQUEST', '并行数量必须为 1–8 的整数');
}
function configure(service, { maxConcurrent }) {
    if (service.policy) fail('PERMISSION_DENIED', '并行预算仅允许受信任本地上下文修改');
    validateLimit(maxConcurrent);
    const submission = acquire('submission'); let execution;
    try {
        execution = acquire();
        if (require('./queue').inventory(service.directory).some(item => item.pending)) fail('BUSY', '队列空闲后才能修改并行数量');
        read(); // 未知或损坏配置不静默覆盖。
        const value = { schema: 'asset-toolbox.scheduling/1', maxConcurrent };
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        safe(path.dirname(filename), true); safe(filename, false, true);
        const temporary = path.join(path.dirname(filename), 'scheduling-' + randomUUID() + '.next');
        try {
            const fd = fs.openSync(temporary, 'wx');
            try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
            fs.renameSync(temporary, filename);
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        return value;
    } finally { execution?.(); submission(); }
}
function snapshot(service) {
    const release = acquire('submission');
    try {
        const { maxConcurrent } = read(), all = require('./queue').inventory(service.directory);
        const pending = all.filter(item => item.pending), running = pending.filter(item => item.running);
        const row = item => {
            try {
                service.metadata(item.id);
                return { jobId: item.id, mode: item.request.mode, createdAt: item.createdAt, state: service.status(item.id, all) };
            } catch (error) {
                if (['PATH_FORBIDDEN', 'PERMISSION_DENIED', 'NOT_FOUND'].includes(error.code)) return null;
                throw error;
            }
        };
        const slots = Array.from({ length: maxConcurrent }, (_, index) => ({ slot: index + 1, occupied: false, job: null }));
        for (const item of running) {
            const slot = slots[item.slot - 1];
            if (!slot || slot.occupied) fail('UNSUPPORTED_VERSION', '执行槽位重复或超出当前预算');
            slot.occupied = true; slot.job = row(item);
        }
        return { maxConcurrent, maxPending: 100, minConcurrent: 1, maxAllowedConcurrent: MAX, ...recommendation(), canConfigure: !service.policy && pending.length === 0,
            runningCount: running.length, waitingCount: pending.length - running.length, slots, waiting: pending.filter(item => !item.running).flatMap(item => { const value = row(item); return value ? [value] : []; }) };
    } finally { release(); }
}
module.exports = { read, configure, snapshot, recommendation, MAX };
