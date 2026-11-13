const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

function alive(pid) {
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
}

function lockRoot() {
    const installation = createHash('sha256').update(fs.realpathSync(path.join(__dirname, '..')).toLowerCase()).digest('hex');
    return path.join(fs.realpathSync(require('node:os').tmpdir()), 'asset-toolbox-locks-' + installation);
}
// 注册共享执行占用与取得独占维护屏障使用同一短临界区。
function acquireGate(name = 'execution') {
    const directory = path.join(lockRoot(), name);
    fs.mkdirSync(directory, { recursive: true });
    const token = randomUUID(), filename = path.join(directory, 'owner.json');
    const claim = path.join(directory, `claim-${process.pid}-${token}`);
    const busy = () => Object.assign(new Error('另一入口正在执行作业，请结束后重试'), { code: 'BUSY', lockName: name });
    fs.writeFileSync(claim, '', { flag: 'wx' });
    try {
        for (const entry of fs.readdirSync(directory)) {
            const match = /^claim-(\d+)-[a-f0-9-]+$/.exec(entry);
            if (match && entry !== path.basename(claim) && alive(Number(match[1]))) throw busy();
        }
        const write = () => fs.writeFileSync(filename, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
        try { write(); }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const before = fs.readFileSync(filename, 'utf8'), previous = JSON.parse(before);
            if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw busy();
            if (alive(previous.pid) || fs.readFileSync(filename, 'utf8') !== before) throw busy();
            fs.unlinkSync(filename);
            write();
        }
        return () => {
            if (fs.existsSync(filename) && JSON.parse(fs.readFileSync(filename, 'utf8')).token === token) fs.unlinkSync(filename);
        };
    } finally { fs.unlinkSync(claim); }
}

function readers(cleanup = true) {
    const directory = path.join(lockRoot(), 'readers');
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).flatMap(name => {
        if (/^[a-f0-9-]+\.next$/.test(name)) return []; // 未原子公布的声明不授予执行权。
        const filename = path.join(directory, name);
        let item;
        try { item = JSON.parse(fs.readFileSync(filename, 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return []; throw error; }
        if (item.schema !== 'asset-toolbox.execution/2' || !Number.isSafeInteger(item.pid) || item.pid < 1 || name !== item.token + '.json' || !/^[a-f0-9]{64}$/.test(item.jobId)) throw new Error('执行占用记录损坏，停止调度');
        require('./resources').validate(item.resources);
        if (!Number.isInteger(item.slot) || item.slot < 1 || item.slot > require('./scheduling').MAX) throw new Error('执行槽位记录无效');
        if (!alive(item.pid)) { if (cleanup) fs.unlinkSync(filename); return []; }
        return [item];
    });
}
function acquire(name = 'execution') {
    const release = acquireGate(name);
    try {
        if (name === 'execution' && readers().length) throw Object.assign(Error('仍有运行作业，不能取得独占执行屏障'), { code: 'BUSY', lockName: name });
        return release;
    } catch (error) { release(); throw error; }
}
function acquireShared(resources, jobId, requestedSlot) {
    const { conflicts, validate } = require('./resources'); validate(resources);
    let release;
    const deadline = Date.now() + 5000;
    for (;;) {
        try { release = acquireGate(); break; }
        catch (error) {
            if (error.code !== 'BUSY' || Date.now() >= deadline) throw error;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        }
    }
    try {
        const active = readers();
        const limit = require('./scheduling').read().maxConcurrent;
        const slot = requestedSlot ?? Array.from({ length: limit }, (_, index) => index + 1).find(value => !active.some(item => item.slot === value));
        if (!Number.isInteger(slot) || slot < 1 || slot > limit || active.some(item => item.slot === slot) || active.length >= limit || active.some(item => conflicts(resources, item.resources))) throw Object.assign(Error('执行资源或槽位仍被占用'), { code: 'BUSY' });
        const directory = path.join(lockRoot(), 'readers'); fs.mkdirSync(directory, { recursive: true });
        const token = randomUUID(), filename = path.join(directory, token + '.json');
        const temporary = path.join(directory, token + '.next');
        const fd = fs.openSync(temporary, 'wx');
        try { fs.writeFileSync(fd, JSON.stringify({ schema: 'asset-toolbox.execution/2', pid: process.pid, token, jobId, resources, slot })); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
        fs.renameSync(temporary, filename);
        return () => { if (fs.existsSync(filename) && JSON.parse(fs.readFileSync(filename, 'utf8')).token === token) fs.unlinkSync(filename); };
    } finally { release(); }
}
module.exports = { acquire, acquireGate, acquireShared, readers, alive };
