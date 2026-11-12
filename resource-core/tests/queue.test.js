const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture } = require('./fixtures/application');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = (f, id) => path.join(f.core, 'data/jobs/v3', id);
test('FIFO spans owners and multiple submissions, persists identity and never overlaps execution', async t => {
    const f = fixture(t, {}, 4, 100), other = new f.ApplicationService(f.policyFile); t.after(() => other.shutdown());
    const first = f.service.submit(f.request, 'first');
    const second = other.submit({ ...f.request, mode: 'preview' }, 'second');
    const third = f.service.submit({ ...f.request, mode: 'preview' }, 'third');
    assert.equal(f.service.status(third.jobId).queuePosition, 3);
    assert.equal(f.service.submit(f.request, 'first').jobId, first.jobId);
    for (const job of [first, second, third]) assert.equal((await f.until(job.jobId)).exitCode, 0);
    for (const [a, b] of [[first, second], [second, third]]) {
        assert.ok(fs.statSync(path.join(directory(f, a.jobId), 'exit.json')).mtimeMs <= fs.statSync(path.join(directory(f, b.jobId), 'dispatch.json')).mtimeMs);
    }
});
test('queued cancellation and owner shutdown do not start workers or cancel another owner', async t => {
    const f = fixture(t), other = new f.ApplicationService(f.policyFile); t.after(() => other.shutdown());
    const release = require(path.join(f.core, 'application/lock')).acquire();
    try {
        const a = f.service.submit(f.request, 'own'), b = other.submit({ ...f.request, mode: 'preview' }, 'other');
        await f.service.shutdown();
        assert.equal(f.service.status(a.jobId).cancelled, true);
        assert.equal(other.status(b.jobId).phase, 'queued');
        other.dispatch('cancel', { jobId: b.jobId }); other.dispatch('cancel', { jobId: b.jobId });
        assert.equal(other.status(b.jobId).cancelled, true);
        for (const job of [a, b]) assert.equal(fs.existsSync(path.join(directory(f, job.jobId), 'worker.json')), false);
        assert.equal(fs.existsSync(f.output), false);
    } finally { release(); }
});
test('dispatch revalidates changed paths before creating a worker', async t => {
    const f = fixture(t), release = require(path.join(f.core, 'application/lock')).acquire();
    const job = f.service.submit(f.request, 'path');
    const held = f.source + '-held'; fs.renameSync(f.source, held);
    release();
    const state = await f.until(job.jobId);
    assert.equal(state.exitCode, 1); assert.equal(fs.existsSync(path.join(directory(f, job.jobId), 'worker.json')), false);
    assert.equal(fs.existsSync(f.output), false);
    fs.renameSync(held, f.source);
});
test('dead queued owners are interrupted without replay and uncertain dispatch claims are not retried', async t => {
    const f = fixture(t), release = require(path.join(f.core, 'application/lock')).acquire();
    try {
        const job = f.service.submit(f.request, 'dead'), dir = directory(f, job.jobId), file = path.join(dir, 'job.json');
        const dead = require('node:child_process').spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid;
        const meta = JSON.parse(fs.readFileSync(file)); fs.writeFileSync(file, JSON.stringify({ ...meta, ownerPid: dead }));
        assert.equal(f.service.status(job.jobId).errorCode, 'INTERRUPTED');
        assert.equal(f.service.submit(f.request, 'dead').replayed, true);
        fs.writeFileSync(path.join(dir, 'dispatch.json'), JSON.stringify({ schema: 'asset-toolbox.dispatch/1', sequence: meta.sequence, owner: meta.owner }));
        assert.equal(f.service.status(job.jobId).errorCode, 'INTERRUPTED');
        await delay(150); assert.equal(fs.existsSync(path.join(dir, 'worker.json')), false);
    } finally { release(); }
});
test('queue capacity is bounded before reserving an idempotency key', async t => {
    const f = fixture(t), release = require(path.join(f.core, 'application/lock')).acquire();
    try {
        for (let i = 0; i < 100; i++) f.service.submit({ ...f.request, mode: 'preview' }, 'capacity-' + i);
        assert.throws(() => f.service.submit(f.request, 'overflow'), { code: 'BUSY' });
        assert.equal(fs.readdirSync(path.join(f.core, 'data/jobs/v3')).length, 100);
        await f.service.shutdown();
    } finally { release(); }
});
test('a dead queue head does not block a live successor or silently replay', async t => {
    const f = fixture(t), release = require(path.join(f.core, 'application/lock')).acquire();
    const first = f.service.submit(f.request, 'gone'), next = f.service.submit({ ...f.request, mode: 'preview' }, 'next');
    const file = path.join(directory(f, first.jobId), 'job.json'), meta = JSON.parse(fs.readFileSync(file));
    const dead = require('node:child_process').spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid;
    fs.writeFileSync(file, JSON.stringify({ ...meta, ownerPid: dead })); release();
    assert.equal((await f.until(next.jobId)).exitCode, 0);
    assert.equal(f.service.status(first.jobId).errorCode, 'INTERRUPTED');
    assert.equal(fs.existsSync(path.join(directory(f, first.jobId), 'worker.json')), false);
});
test('adapter changes while waiting fail closed before modifying assets', async t => {
    const f = fixture(t), release = require(path.join(f.core, 'application/lock')).acquire();
    const first = f.service.submit(f.request, 'version');
    const provider = path.join(f.core, 'providers/fixture/index.js');
    fs.writeFileSync(provider, fs.readFileSync(provider, 'utf8').replaceAll("version:'1.0.0'", "version:'2.0.0'")); release();
    const state = await f.until(first.jobId); assert.equal(state.exitCode, 1);
    assert.equal(fs.readFileSync(path.join(f.source, '0.pack'), 'utf8'), 'PACK:' + 'test'.repeat(100));
    assert.equal(fs.existsSync(path.join(f.output, '0.pack')), false);
});
test('public submit waits through brief submission contention without duplicating identity', async t => {
    const f = fixture(t), release = require(path.join(f.core, 'application/lock')).acquire('submission');
    const response = f.call('submit', { request: { ...f.request, mode: 'preview' }, idempotencyKey: 'contended' });
    setTimeout(release, 100);
    const submitted = await response; assert.equal(submitted.ok, true);
    const replay = await f.call('submit', { request: { ...f.request, mode: 'preview' }, idempotencyKey: 'contended' });
    assert.equal(replay.result.jobId, submitted.result.jobId); assert.equal(replay.result.replayed, true);
    assert.equal((await f.until(submitted.result.jobId)).exitCode, 0);
});
test('unknown dispatch versions are rejected and never executed', async t => {
    const f = fixture(t), release = require(path.join(f.core, 'application/lock')).acquire();
    try {
        const job = f.service.submit(f.request, 'unknown-claim'), dir = directory(f, job.jobId);
        fs.writeFileSync(path.join(dir, 'dispatch.json'), JSON.stringify({ schema: 'asset-toolbox.dispatch/0' }));
        assert.throws(() => f.service.status(job.jobId), { code: 'UNSUPPORTED_VERSION' });
        await delay(150); assert.equal(fs.existsSync(path.join(dir, 'worker.json')), false);
    } finally { release(); }
});
