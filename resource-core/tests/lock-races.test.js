const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture } = require('./fixtures/application');
const { spawnSync } = require('node:child_process');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a gate owner releasing after EEXIST is contention, not a fatal missing file', t => {
    const f = fixture(t), lock = require(path.join(f.core, 'application/lock'));
    for (const name of ['execution', 'submission', 'services']) {
        const release = lock.acquireGate(name), write = fs.writeFileSync;
        let raced = false;
        const mock = t.mock.method(fs, 'writeFileSync', function (filename, ...args) {
            try { return write.call(this, filename, ...args); }
            catch (error) {
                if (error.code === 'EEXIST' && path.basename(filename) === 'owner.json') {
                    raced = true; release(); // 原持有者恰好在竞争者准备读 owner 时退出。
                }
                throw error;
            }
        });
        try { assert.throws(() => lock.acquireGate(name), { code: 'BUSY', lockName: name }); }
        finally { mock.mock.restore(); release(); }
        assert.equal(raced, true);
        lock.acquireGate(name)();
    }
});

test('gate contention never steals live or malformed ownership and does not hide unrelated I/O errors', t => {
    const f = fixture(t), lock = require(path.join(f.core, 'application/lock'));
    const write = fs.writeFileSync; let owner;
    const capture = t.mock.method(fs, 'writeFileSync', function (filename, ...args) {
        if (path.basename(filename) === 'owner.json') owner = filename;
        return write.call(this, filename, ...args);
    });
    const release = lock.acquireGate(); capture.mock.restore();
    const before = fs.readFileSync(owner);
    try {
        assert.throws(() => lock.acquireGate(), { code: 'BUSY' });
        assert.deepEqual(fs.readFileSync(owner), before);
        const read = fs.readFileSync;
        const denied = t.mock.method(fs, 'readFileSync', function (filename, ...args) {
            if (filename === owner) throw Object.assign(Error('模拟拒绝读取'), { code: 'EACCES' });
            return read.call(this, filename, ...args);
        });
        try { assert.throws(() => lock.acquireGate(), { code: 'EACCES' }); }
        finally { denied.mock.restore(); }
        fs.writeFileSync(owner, '{');
        assert.throws(() => lock.acquireGate(), SyntaxError);
        assert.equal(fs.readFileSync(owner, 'utf8'), '{');
        fs.writeFileSync(owner, JSON.stringify({ pid: -1 }));
        assert.throws(() => lock.acquireGate(), { code: 'BUSY' });
    } finally { fs.writeFileSync(owner, before); release(); }
    const dead = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
    assert.equal(dead.status, 0);
    fs.writeFileSync(owner, JSON.stringify({ pid: dead.pid, token: 'stale' }));
    lock.acquireGate()();
    assert.equal(fs.existsSync(owner), false);
});

// 只在隔离副本的 worker 中设置门闩；不依赖 CPU 负载或碰巧命中时间窗口。
function pauseContendingWorker(f) {
    const ready = path.join(f.root, 'contender-ready'), released = path.join(f.root, 'owner-released');
    const batch = path.join(f.core, 'batch.js');
    fs.writeFileSync(batch, `{
        const fs = require('node:fs'), path = require('node:path'), write = fs.writeFileSync;
        fs.writeFileSync = function(filename, ...args) {
            try { return write.call(this, filename, ...args); }
            catch (error) {
                if (error.code === 'EEXIST' && path.basename(filename) === 'owner.json') {
                    fs.writeFileSync = write;
                    write(${JSON.stringify(ready)}, '');
                    const end = Date.now() + 10000;
                    while (!fs.existsSync(${JSON.stringify(released)})) {
                        if (Date.now() >= end) throw Error('等待测试持有者释放超时');
                        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
                    }
                }
                throw error;
            }
        };
    }\n` + fs.readFileSync(batch, 'utf8'));
    return { ready, released };
}

for (const mode of ['process', 'retry']) test(`worker ${mode} survives gate release between exclusive open and owner read`, async t => {
    const f = fixture(t, {}, 1), lock = require(path.join(f.core, 'application/lock'));
    let request = f.request;
    if (mode === 'retry') {
        const first = f.service.submit(request, 'initial');
        const state = await f.until(first.jobId); assert.equal(state.exitCode, 0, JSON.stringify(state));
        request = { mode, taskId: state.taskId };
    }
    const signals = pauseContendingWorker(f);
    // 同步派发一次后停掉自动轮询，保证只有这个已持有的登记锁参与竞争。
    f.service.queue.stop();
    const job = f.service.submit(request, 'racing-worker');
    f.service.queue.closed = false; f.service.queue.tick(); f.service.queue.stop();
    const release = lock.acquireGate();
    try {
        const end = Date.now() + 10000;
        while (!fs.existsSync(signals.ready)) {
            assert.ok(Date.now() < end, 'worker 未进入锁竞争窗口'); await delay(10);
        }
    } finally { release(); fs.writeFileSync(signals.released, ''); }
    const state = await f.until(job.jobId);
    assert.equal(state.exitCode, 0, JSON.stringify(state));
    assert.equal(state.summary.total, mode === 'retry' ? 0 : 1);
    assert.equal(f.service.submit(request, 'racing-worker').replayed, true);
    assert.equal(fs.readFileSync(path.join(f.source, '0.pack'), 'utf8'), 'PACK:' + 'test'.repeat(100));
    assert.equal(fs.readFileSync(path.join(f.output, '0.pack'), 'utf8'), 'PACK:tes');
    assert.deepEqual(lock.readers(), []);
});

test('an orphan worker retains resources after finishing work until its process actually exits', async t => {
    const f = fixture(t, {}, 1), lock = require(path.join(f.core, 'application/lock'));
    const finished = path.join(f.root, 'worker-finished'), exit = path.join(f.root, 'worker-may-exit');
    const batch = path.join(f.core, 'batch.js');
    fs.appendFileSync(batch, `\nprocess.once('beforeExit', () => {
        fs.writeFileSync(${JSON.stringify(finished)}, '');
        const end = Date.now() + 10000;
        while (!fs.existsSync(${JSON.stringify(exit)}) && Date.now() < end)
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    });\n`);
    const observer = f.ApplicationService.forDesktop();
    const job = f.service.submit(f.request, 'orphan-exit-window');
    try {
        const end = Date.now() + 10000;
        while (!fs.existsSync(finished)) { assert.ok(Date.now() < end); await delay(10); }
        const directory = path.join(f.core, 'data/jobs/v5', job.jobId);
        const metaFile = path.join(directory, 'job.json'), meta = JSON.parse(fs.readFileSync(metaFile));
        const worker = JSON.parse(fs.readFileSync(path.join(directory, 'worker.json')));
        const dead = spawnSync(process.execPath, ['-e', ''], { windowsHide: true }); assert.equal(dead.status, 0);
        // 模拟父进程在发布 worker 身份前崩溃，只有 worker 独立占用仍可证明存活。
        fs.writeFileSync(metaFile, JSON.stringify({ ...meta, ownerPid: dead.pid }));
        fs.unlinkSync(path.join(directory, 'worker.json'));
        assert.equal(lock.alive(worker.pid), true);
        assert.equal(observer.status(job.jobId).done, false);
        const next = observer.submit({ ...f.request, mode: 'preview' }, 'after-orphan-exit');
        observer.queue.tick();
        assert.equal(observer.status(next.jobId).phase, 'queued');
        assert.equal(observer.status(next.jobId).waitReason, 'resource-conflict');
        assert.equal(fs.existsSync(path.join(f.core, 'data/jobs/v5', next.jobId, 'dispatch.json')), false);
        assert.throws(() => lock.acquire(), { code: 'BUSY' });
        fs.writeFileSync(exit, '');
        const first = await f.until(job.jobId); assert.equal(first.exitCode, 0, JSON.stringify(first));
        const second = await f.until(next.jobId); assert.equal(second.exitCode, 0, JSON.stringify(second));
        assert.equal(lock.alive(worker.pid), false);
        assert.deepEqual(lock.readers(), []);
    } finally { fs.writeFileSync(exit, ''); await observer.shutdown(); }
});
