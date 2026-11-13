const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { fixture } = require('./fixtures/application');
const { cliCommand } = require('./helpers');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function tree(root) {
    if (!fs.existsSync(root)) return {};
    return Object.fromEntries(fs.readdirSync(root, { recursive: true }).filter(name => fs.statSync(path.join(root, name)).isFile()).map(name => [name, digest(fs.readFileSync(path.join(root, name)))]));
}
async function setup(t, requestOverrides = {}) {
    const f = fixture(t, { allowRestore: true, allowOverwrite: true }, 4, 0);
    const { localContext } = require(path.join(f.core, 'application/context'));
    const local = new f.ApplicationService(localContext()); t.after(() => local.shutdown());
    const request = typeof requestOverrides === 'function' ? requestOverrides(f) : { ...f.request, ...requestOverrides };
    const { jobId } = f.service.submit(request, 'retention');
    const finished = await f.until(jobId); assert.equal(finished.exitCode, 0);
    const state = { ...finished, reportDirectory: f.service.rawStatus(jobId).reportDirectory };
    const directory = path.join(f.core, 'data/jobs/v5', jobId);
    const age = () => {
        const old = new Date(Date.now() - 45 * 86400000);
        const file = path.join(directory, 'job.json'), meta = JSON.parse(fs.readFileSync(file)); meta.createdAt = old.toISOString(); fs.writeFileSync(file, JSON.stringify(meta));
        for (const folder of [directory, state.reportDirectory].filter(Boolean)) for (const name of fs.readdirSync(folder)) fs.utimesSync(path.join(folder, name), old, old);
    };
    const preview = () => local.dispatch('storage-preview');
    const select = () => preview().items.filter(item => item.eligible).map(({ jobId, fingerprint }) => ({ jobId, fingerprint }));
    const clean = (selection = select()) => local.dispatch('storage-clean', { retentionDays: 30, selection });
    return { ...f, request, local, jobId, state, directory, age, preview, select, clean };
}

test('retention preview is read-only, defaults to 30 days and keeps fresh and unfinished work', async t => {
    const f = await setup(t);
    const before = tree(path.join(f.core, 'data'));
    assert.equal(f.preview().eligibleCount, 0); assert.equal(f.preview().retentionDays, 30);
    assert.deepEqual(tree(path.join(f.core, 'data')), before);
    f.age(); assert.equal(f.preview().eligibleCount, 1);
    const task = require(path.join(f.core, 'tasks')).loadTask(f.local.taskFile(f.state.taskId));
    const release = task.lock();
    try { task.finish({ path: '0.pack', status: 'failed', message: '待重试' }); } finally { release(); }
    assert.equal(f.preview().eligibleCount, 0); assert.match(f.preview().items[0].reason, /任务尚未完成/);
    for (const retentionDays of [0, 1.5, '30', null, 3651]) assert.throws(() => f.local.dispatch('storage-preview', { retentionDays }), { code: 'INVALID_REQUEST' });
});

test('selected cleanup preserves task journals, backups, source, output and idempotency across desktop and CLI', async t => {
    const f = await setup(t, base => { const { outputDir, ...request } = base.request; return { ...request, backupDir: base.backup }; });
    f.age();
    const { DesktopBridge } = require(path.join(f.core, 'desktop-bridge'));
    const bridge = new DesktopBridge(); t.after(() => bridge.shutdown());
    const rows = await bridge.dispatch('storage-preview', {}); assert.equal(rows.eligibleCount, 1);
    const preserved = [f.source, f.backup, path.join(f.core, 'data/tasks')].map(tree);
    const cleaned = f.clean(); assert.equal(cleaned.cleaned, 1); assert.equal(cleaned.failed, 0);
    assert.deepEqual([f.source, f.backup, path.join(f.core, 'data/tasks')].map(tree), preserved);
    const state = await bridge.dispatch('status', { jobId: f.jobId });
    assert.equal(state.resultsExpired, true); assert.equal(state.hasReport, false); assert.equal(state.taskId, f.state.taskId);
    assert.equal(fs.existsSync(f.state.reportDirectory), false);
    const replay = f.service.submit(f.request, 'retention'); assert.equal(replay.replayed, true); assert.equal(replay.state.resultsExpired, true);
    const cli = spawnSync(process.execPath, cliCommand(f.tool, 'status', { jobId: f.jobId }), { encoding: 'utf8', windowsHide: true });
    assert.equal(cli.status, 0, cli.stderr); assert.deepEqual(JSON.parse(cli.stdout).result, state);
    assert.throws(() => f.local.results(f.jobId, 'files', {}), { code: 'RESULTS_EXPIRED' });
    assert.throws(() => f.local.reportLocation(f.jobId), { code: 'RESULTS_EXPIRED' });
    assert.equal(f.preview().eligibleCount, 0);
    const restore = f.service.submit({ mode: 'restore-preview', taskId: f.state.taskId }, 'after-clean');
    assert.equal((await f.until(restore.jobId)).exitCode, 0);
    assert.equal(f.service.results(restore.jobId, 'restore', {}).items.length, 4);
});

test('cleanup detects stale previews, empty or duplicate selections before any deletion', async t => {
    const f = await setup(t); f.age();
    assert.throws(() => f.clean([]), { code: 'INVALID_REQUEST' });
    const selection = f.select();
    assert.throws(() => f.local.dispatch('storage-clean', { selection }), { code: 'INVALID_REQUEST' });
    assert.throws(() => f.local.dispatch('storage-clean', { retentionDays: 31, selection }), { code: 'STALE_PREVIEW' });
    assert.throws(() => f.clean([...selection, ...selection]), { code: 'INVALID_REQUEST' });
    fs.appendFileSync(path.join(f.state.reportDirectory, 'files.csv'), 'changed');
    const before = tree(path.join(f.core, 'data'));
    assert.throws(() => f.clean(selection), { code: 'STALE_PREVIEW' });
    assert.deepEqual(tree(path.join(f.core, 'data')), before);
    assert.equal(fs.existsSync(path.join(f.directory, 'retention.json')), false);
});

test('global maintenance refuses policy contexts and shared reports and serializes with execution and submission', async t => {
    const f = await setup(t); f.age();
    assert.throws(() => f.service.dispatch('storage-preview'), { code: 'PERMISSION_DENIED' });
    assert.throws(() => f.service.dispatch('storage-clean', { retentionDays: 30, selection: f.select() }), { code: 'PERMISSION_DENIED' });
    for (const name of ['execution', 'submission']) {
        const selection = f.select(), release = require(path.join(f.core, 'application/lock')).acquire(name);
        try { assert.throws(() => f.clean(selection), { code: 'BUSY' }); } finally { release(); }
    }
    const duplicate = path.join(path.dirname(f.directory), 'a'.repeat(64)); fs.cpSync(f.directory, duplicate, { recursive: true });
    const meta = JSON.parse(fs.readFileSync(path.join(duplicate, 'job.json'))); meta.id = 'a'.repeat(64); fs.writeFileSync(path.join(duplicate, 'job.json'), JSON.stringify(meta));
    assert.equal(f.preview().eligibleCount, 0); assert.match(f.preview().items[0].reason, /引用无法唯一确认/);
});

test('links, hardlinks, unexpected files and unknown retention versions fail closed', async t => {
    const f = await setup(t); f.age();
    const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'report.json'), 'user file');
    const selection = f.select();
    const report = f.state.reportDirectory, held = report + '-held'; fs.renameSync(report, held); fs.symlinkSync(outside, report, 'junction');
    assert.throws(() => f.clean(selection), { code: 'STALE_PREVIEW' });
    assert.equal(f.preview().eligibleCount, 0); assert.equal(fs.readFileSync(path.join(outside, 'report.json'), 'utf8'), 'user file');
    fs.unlinkSync(report); fs.renameSync(held, report);
    fs.linkSync(path.join(report, 'report.json'), path.join(outside, 'hard.json'));
    assert.equal(f.preview().eligibleCount, 0); fs.unlinkSync(path.join(outside, 'hard.json'));
    fs.writeFileSync(path.join(report, 'unknown.txt'), 'keep'); assert.equal(f.preview().eligibleCount, 0); fs.unlinkSync(path.join(report, 'unknown.txt'));
    fs.writeFileSync(path.join(f.directory, 'retention.json'), JSON.stringify({ schema: 'asset-toolbox.retention/0' }));
    assert.throws(() => f.local.status(f.jobId), { code: 'UNSUPPORTED_VERSION' }); assert.equal(f.preview().eligibleCount, 0);
});

test('an interrupted cleanup leaves a durable expired state and resumes only unchanged remaining files', async t => {
    const f = await setup(t); f.age();
    const original = fs.unlinkSync;
    const target = path.join(f.state.reportDirectory, 'report.json');
    const mock = t.mock.method(fs, 'unlinkSync', filename => { if (filename === target) throw Error('模拟文件被占用'); return original(filename); });
    const failed = f.clean(); assert.equal(failed.failed, 1);
    assert.equal(f.local.status(f.jobId).resultsExpired, true);
    assert.throws(() => f.local.results(f.jobId, 'files', {}), { code: 'RESULTS_EXPIRED' });
    mock.mock.restore();
    const retained = fs.readFileSync(target);
    fs.appendFileSync(target, 'changed after partial cleanup');
    assert.equal(f.preview().eligibleCount, 0);
    assert.match(f.preview().items[0].reason, /文件已变化/);
    fs.writeFileSync(target, retained);
    assert.equal(f.preview().eligibleCount, 1);
    const finished = f.clean(); assert.equal(finished.cleaned, 1);
    assert.equal(fs.existsSync(target), false); assert.equal(f.preview().eligibleCount, 0);
    assert.ok(fs.existsSync(path.join(f.directory, 'job.json')));
});

test('preview details can expire without changing task restore journals or replaying the preview', async t => {
    const f = await setup(t, { mode: 'preview' }); f.age();
    assert.equal(f.clean().cleaned, 1);
    const replay = f.service.submit({ ...f.request, mode: 'preview' }, 'retention');
    assert.equal(replay.replayed, true); assert.equal(replay.jobId, f.jobId); assert.equal(replay.state.resultsExpired, true);
    assert.throws(() => f.local.results(f.jobId, 'restore', {}), { code: 'RESULTS_EXPIRED' });
});

test('failed, cancelled and starting jobs remain protected even when older than the retention period', async t => {
    const f = await setup(t), filename = path.join(f.directory, 'status.json');
    const original = JSON.parse(fs.readFileSync(filename));
    for (const change of [{ exitCode: 1, error: 'failed' }, { exitCode: 2, cancelled: true }]) {
        fs.writeFileSync(filename, JSON.stringify({ ...original, ...change })); f.age();
        assert.equal(f.preview().eligibleCount, 0);
        assert.match(f.preview().items[0].reason, /仅清理成功/);
    }
    fs.writeFileSync(filename, JSON.stringify(original)); f.age();
    const selection = f.select(); assert.equal(selection.length, 1);
    const active = path.join(path.dirname(f.directory), 'b'.repeat(64)); fs.mkdirSync(active);
    const meta = JSON.parse(fs.readFileSync(path.join(f.directory, 'job.json')));
    fs.writeFileSync(path.join(active, 'job.json'), JSON.stringify({ ...meta, id: 'b'.repeat(64), ownerPid: process.pid }));
    fs.writeFileSync(path.join(active, 'status.json'), JSON.stringify({ phase: 'starting', done: false }));
    assert.equal(f.preview().items.find(item => item.jobId === 'b'.repeat(64)).eligible, false);
    assert.throws(() => f.clean(selection), { code: 'BUSY' });
    assert.equal(fs.existsSync(path.join(f.directory, 'retention.json')), false);
});
