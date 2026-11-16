const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { fixture } = require('./fixtures/application');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { const end = Date.now() + 20000; while (Date.now() < end) { if (predicate()) return; await delay(25); } throw Error('槽位状态等待超时'); }
function local(t, f) { const value = f.ApplicationService.forDesktop(); t.after(() => value.shutdown()); return value; }

test('local budget persists across services and CLI; policy clients cannot change it or inject resource limits', async t => {
    const f = fixture(t), service = local(t, f);
    const initial = service.dispatch('queue'); assert.equal(initial.maxConcurrent, 2); assert.equal(initial.slots.length, 2);
    assert.ok(initial.availableProcessors >= 1); assert.equal(initial.recommendedConcurrent, Math.min(4, Math.max(1, Math.floor(initial.availableProcessors / 4))));
    for (const maxConcurrent of [0, 9, 1.5, '4', null]) assert.throws(() => service.dispatch('scheduling-set', { maxConcurrent }), { code: 'INVALID_REQUEST' });
    assert.throws(() => f.service.dispatch('scheduling-set', { maxConcurrent: 3 }), { code: 'PERMISSION_DENIED' });
    assert.throws(() => service.dispatch('submit', { request: f.request, idempotencyKey: 'bad', maxConcurrent: 8 }), { code: 'INVALID_REQUEST' });
    service.dispatch('scheduling-set', { maxConcurrent: 8 });
    assert.equal(local(t, f).dispatch('queue').slots.length, 8);
    service.dispatch('scheduling-set', { maxConcurrent: 3 });
    const result = spawnSync(process.execPath, [path.join(f.core, 'cli.js'), 'api', 'queue', '--local'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).result.maxConcurrent, 3);
    assert.equal(f.service.dispatch('queue').canConfigure, false);
});

test('three slots execute concurrently with stable identities; overflow waits and unauthorized jobs stay anonymous', async t => {
    const f = fixture(t, {}, 5, 350), service = local(t, f);
    service.dispatch('scheduling-set', { maxConcurrent: 3 });
    const jobs = Array.from({ length: 4 }, (_, index) => service.submit({ ...f.request, outputDir: index ? f.output + '-' + index : f.output }, 'slot-' + index));
    await until(() => jobs.slice(0, 3).every(job => service.status(job.jobId).processed >= 1));
    const snapshot = service.dispatch('queue');
    assert.equal(snapshot.runningCount, 3); assert.equal(snapshot.waitingCount, 1);
    assert.deepEqual(snapshot.slots.map(slot => slot.job.jobId), jobs.slice(0, 3).map(job => job.jobId));
    assert.equal(snapshot.waiting[0].state.waitReason, 'capacity');
    assert.throws(() => service.dispatch('scheduling-set', { maxConcurrent: 1 }), { code: 'BUSY' });
    const hidden = f.service.dispatch('queue');
    assert.equal(hidden.slots.filter(slot => slot.occupied).length, 3);
    assert.equal(hidden.slots.filter(slot => slot.job).length, 1); assert.deepEqual(hidden.waiting, []);
    for (const job of jobs.slice(1)) assert.equal(JSON.stringify(hidden).includes(job.jobId), false);
    for (const job of jobs) { await until(() => service.status(job.jobId).done); assert.equal(service.status(job.jobId).exitCode, 0); }
    const claims = jobs.map(job => JSON.parse(fs.readFileSync(path.join(f.core, 'data/jobs/v6', job.jobId, 'dispatch.json'))));
    assert.deepEqual(claims.slice(0, 3).map(claim => claim.slot), [1, 2, 3]);
    assert.ok([1, 2, 3].includes(claims[3].slot));
    service.dispatch('scheduling-set', { maxConcurrent: 1 });
    assert.equal(service.dispatch('queue').slots.length, 1);
    assert.ok(jobs.every(job => service.status(job.jobId).done)); // 降低预算不使旧高编号历史失效。
});

test('waiting work blocks budget changes; malformed and linked scheduling files fail closed', async t => {
    const f = fixture(t), service = local(t, f), release = require(path.join(f.core, 'application/lock')).acquire();
    const job = service.submit({ ...f.request, mode: 'preview' }, 'waiting');
    release(); // 不让事件循环派发，直接检查等待项本身也阻止变更。
    assert.throws(() => service.dispatch('scheduling-set', { maxConcurrent: 4 }), { code: 'BUSY' });
    service.dispatch('cancel', { jobId: job.jobId });
    service.dispatch('scheduling-set', { maxConcurrent: 2 });
    const filename = path.join(f.core, 'data/scheduling.json');
    fs.writeFileSync(filename, JSON.stringify({ schema: 'asset-toolbox.scheduling/0', maxConcurrent: 8 }));
    assert.throws(() => service.dispatch('queue'), { code: 'UNSUPPORTED_VERSION' });
    assert.throws(() => service.dispatch('scheduling-set', { maxConcurrent: 3 }), { code: 'UNSUPPORTED_VERSION' });
    const outside = path.join(f.root, 'unchanged.json'); fs.writeFileSync(outside, 'unchanged'); fs.unlinkSync(filename); fs.linkSync(outside, filename);
    assert.throws(() => service.dispatch('scheduling-set', { maxConcurrent: 3 }), { code: 'PATH_FORBIDDEN' });
    assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged');
});

test('slot gaps remain stable and duplicate reservations or execution slots fail closed', t => {
    const f = fixture(t), service = local(t, f);
    service.dispatch('scheduling-set', { maxConcurrent: 3 });
    const { schedule } = require(path.join(f.core, 'application/resources'));
    const lock = require(path.join(f.core, 'application/lock'));
    const resources = { schema: 'asset-toolbox.resources/1', entries: [{ kind: 'provider', key: 'fixture', access: 'read' }] };
    const active = { id: 'a'.repeat(64), resources, pending: true, running: true, slot: 3 };
    const waiting = { id: 'b'.repeat(64), resources, pending: true, running: false };
    assert.equal(schedule([active, waiting]).selected[0].slot, 1);
    assert.equal(active.slot, 3);
    assert.throws(() => schedule([active, { ...active, id: waiting.id }]), { code: 'UNSUPPORTED_VERSION' });
    assert.throws(() => schedule([{ ...active, slot: 4 }]), { code: 'UNSUPPORTED_VERSION' });
    const release = lock.acquireShared(resources, active.id, 3);
    try {
        assert.throws(() => lock.acquireShared(resources, waiting.id, 3), { code: 'BUSY' });
        assert.throws(() => lock.acquireShared(resources, waiting.id, 4), { code: 'BUSY' });
        assert.throws(() => service.dispatch('queue'), /作业目录缺失/);
        fs.mkdirSync(path.join(f.core, 'data/jobs/v6'), { recursive: true });
        const snapshot = service.dispatch('queue');
        assert.deepEqual(snapshot.slots.map(item => item.occupied), [false, false, true]);
        assert.equal(snapshot.slots[2].job, null); // 无 job.json 的活占用依然保留槽位。
        assert.equal(snapshot.canConfigure, false);
    } finally { release(); }
});
