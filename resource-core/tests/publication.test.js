const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture } = require('./fixtures/application');

// 在真实 open 与 write 之间观察；旧实现会暴露空最终文件，新实现只暴露暂存路径。
function duringWrite(t, target, observe) {
    const open = fs.openSync, write = fs.writeFileSync, files = new Map();
    let result;
    const opened = t.mock.method(fs, 'openSync', function (filename, ...args) {
        const fd = open(filename, ...args); files.set(fd, String(filename)); return fd;
    });
    const written = t.mock.method(fs, 'writeFileSync', function (filename, data, options) {
        const name = typeof filename === 'number' ? files.get(filename) : String(filename);
        if (!result && name?.split(path.sep).some(part => part === target || part.startsWith(target + '.'))) {
            const fd = typeof filename === 'number' ? filename : open(filename, options?.flag || 'w');
            result = {};
            try {
                try { result.value = observe(); } catch (error) { result.error = error; }
                return write(fd, data, options);
            } finally { if (typeof filename !== 'number') fs.closeSync(fd); }
        }
        return write(filename, data, options);
    });
    return { result: () => result, restore: () => { written.mock.restore(); opened.mock.restore(); } };
}

test('new jobs are invisible to lists and queue scans until their metadata is complete', async t => {
    const f = fixture(t, {}, 1), observer = f.ApplicationService.forDesktop();
    t.after(() => observer.shutdown()); f.service.queue.stop();
    const probe = duringWrite(t, 'job.json', () => ({ jobs: observer.dispatch('jobs'), queue: require(path.join(f.core, 'application/queue')).inventory(f.service.directory) }));
    let job;
    try { job = f.service.submit(f.request, 'publication'); } finally { probe.restore(); }
    assert.ok(probe.result()); assert.equal(probe.result().error, undefined);
    assert.equal(probe.result().value.jobs.total, 0); assert.equal(probe.result().value.queue.length, 0);
    assert.deepEqual(observer.dispatch('jobs').items.map(item => item.jobId), [job.jobId]);
    assert.equal(f.service.submit(f.request, 'publication').replayed, true);
});

for (const filename of ['dispatch.json', 'worker.json', 'exit.json']) test(`observers never see half-written ${filename} or release a slot before exit publication`, async t => {
    const f = fixture(t, {}, 1), observer = f.ApplicationService.forDesktop();
    t.after(() => observer.shutdown()); f.service.queue.stop();
    const job = f.service.submit(f.request, 'publication');
    const probe = duringWrite(t, filename, () => ({ state: observer.status(job.jobId), queue: require(path.join(f.core, 'application/queue')).inventory(f.service.directory) }));
    let completed;
    try {
        f.service.queue.closed = false; f.service.queue.tick(); f.service.queue.stop();
        completed = await f.until(job.jobId);
    } finally { probe.restore(); }
    assert.equal(completed.exitCode, 0, JSON.stringify(completed));
    assert.ok(probe.result(), filename); assert.equal(probe.result().error, undefined);
    assert.equal(probe.result().value.state.done, false);
    assert.equal(probe.result().value.queue[0].pending, true);
    if (filename === 'exit.json') assert.equal(probe.result().value.queue[0].running, true);
    assert.equal(observer.status(job.jobId).done, true);
});

for (const mode of ['cancel', 'start-failure']) test(`terminal ${mode} status is published completely before observers can read it`, t => {
    const f = fixture(t, {}, 1), observer = f.ApplicationService.forDesktop();
    t.after(() => observer.shutdown()); f.service.queue.stop();
    const job = f.service.submit(f.request, 'terminal');
    const probe = duringWrite(t, 'status.json', () => observer.status(job.jobId));
    try {
        if (mode === 'cancel') f.service.dispatch('cancel', { jobId: job.jobId });
        else {
            t.mock.method(f.service, 'normalize', () => { throw new Error('模拟启动预检失败'); });
            f.service.queue.closed = false; f.service.queue.tick(); f.service.queue.stop();
        }
    } finally { probe.restore(); }
    assert.ok(probe.result()); assert.equal(probe.result().error, undefined);
    assert.equal(probe.result().value.done, false);
    const completed = observer.status(job.jobId);
    assert.equal(completed.done, true); assert.equal(completed.exitCode, mode === 'cancel' ? 2 : 1);
    assert.equal(fs.existsSync(path.join(f.core, 'data/jobs/v6', job.jobId, 'worker.json')), false);
});

test('exclusive publication rejects concurrent writers and existing files, and failed sync leaves no partial record', t => {
    const f = fixture(t), { writeExclusive, publishJob } = require(path.join(f.core, 'application/publication'));
    const filename = path.join(f.root, 'record.json');
    const probe = duringWrite(t, 'record.json', () => {
        assert.throws(() => writeExclusive(filename, { other: true }), { code: 'EEXIST' });
        assert.equal(fs.existsSync(filename), false);
    });
    try { writeExclusive(filename, { complete: true }); } finally { probe.restore(); }
    assert.ok(probe.result()); assert.equal(probe.result().error, undefined);
    const original = fs.readFileSync(filename);
    assert.throws(() => writeExclusive(filename, { overwritten: true }), { code: 'EEXIST' });
    assert.deepEqual(fs.readFileSync(filename), original); assert.equal(fs.statSync(filename).nlink, 1);
    const denied = t.mock.method(fs, 'fsyncSync', () => { throw Object.assign(new Error('模拟磁盘同步失败'), { code: 'EIO' }); });
    const failed = path.join(f.root, 'failed.json'), unpublished = path.join(f.root, 'jobs', 'a'.repeat(64));
    try {
        assert.throws(() => writeExclusive(failed, {}), { code: 'EIO' });
        assert.throws(() => publishJob(unpublished, {}), { code: 'EIO' });
    } finally { denied.mock.restore(); }
    assert.equal(fs.existsSync(failed), false); assert.equal(fs.existsSync(failed + '.writing'), false);
    assert.equal(fs.existsSync(unpublished), false); assert.deepEqual(fs.readdirSync(path.dirname(unpublished)), []);
    const linked = path.join(f.root, 'linked.json'); fs.linkSync(filename, linked);
    assert.throws(() => writeExclusive(linked, {}), { code: 'EEXIST' });
    assert.deepEqual(fs.readFileSync(filename), original);
});

test('committed corrupt metadata still fails instead of being treated as an unpublished record', async t => {
    const f = fixture(t, {}, 1), observer = f.ApplicationService.forDesktop(); t.after(() => observer.shutdown());
    const job = f.service.submit(f.request, 'corrupt');
    assert.equal((await f.until(job.jobId)).exitCode, 0);
    const directory = path.join(f.core, 'data/jobs/v6', job.jobId);
    for (const name of ['job.json', 'dispatch.json', 'worker.json', 'exit.json', 'status.json']) {
        const filename = path.join(directory, name), before = fs.readFileSync(filename);
        try {
            fs.writeFileSync(filename, '{');
            assert.throws(() => require(path.join(f.core, 'application/queue')).inventory(f.service.directory), SyntaxError);
            if (name !== 'exit.json') assert.throws(() => observer.status(job.jobId), SyntaxError);
        } finally { fs.writeFileSync(filename, before); }
    }
    assert.equal(observer.status(job.jobId).exitCode, 0);
    assert.equal(fs.readFileSync(path.join(f.source, '0.pack'), 'utf8'), 'PACK:' + 'test'.repeat(100));
});
