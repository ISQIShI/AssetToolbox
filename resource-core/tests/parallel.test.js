const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { fixture } = require('./fixtures/application');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const jobDir = (f, id) => path.join(f.core, 'data/jobs/v5', id);
function local(t, f) {
    const service = f.ApplicationService.forDesktop(); t.after(() => service.shutdown()); return service;
}
async function until(predicate) {
    const end = Date.now() + 15000;
    while (Date.now() < end) { if (predicate()) return; await delay(20); }
    throw Error('并行条件未满足');
}
function gateProvider(t, f) {
    const gate = path.join(f.root, 'gate'), events = path.join(f.root, 'events');
    fs.writeFileSync(path.join(f.core, 'providers/fixture/index.js'), `const fs=require('node:fs');module.exports={apiVersion:2,version:'1.0.0',displayName:'隔离门闩',adapters:{compress:{version:'1.0.0',resourceTypes:['fixture'],execute({input,output}){fs.appendFileSync(${JSON.stringify(events)},process.pid+'\\n');const end=Date.now()+12000;while(!fs.existsSync(${JSON.stringify(gate)})&&Date.now()<end)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);fs.writeFileSync(output,fs.readFileSync(input).subarray(0,8));return {output};}}}};`);
    const open = () => { if (fs.existsSync(f.root)) fs.writeFileSync(gate, ''); }; t.after(open);
    return { open, count: () => fs.existsSync(events) ? fs.readFileSync(events, 'utf8').trim().split('\n').length : 0 };
}

test('two owners run independent writes concurrently; a third waits for capacity and maintenance stays exclusive', async t => {
    const f = fixture(t, {}, 1), gate = gateProvider(t, f), a = local(t, f), b = local(t, f);
    const jobs = [a.submit(f.request, 'a'), b.submit({ ...f.request, outputDir: f.output + '-b' }, 'b'), a.submit({ ...f.request, outputDir: f.output + '-c' }, 'c')];
    try {
        await until(() => gate.count() === 2);
        assert.equal(a.status(jobs[2].jobId).waitReason, 'capacity', JSON.stringify(jobs.map(job => a.status(job.jobId))));
        assert.equal(a.status(jobs[2].jobId).runningCount, 2);
        assert.equal(fs.existsSync(path.join(jobDir(f, jobs[2].jobId), 'dispatch.json')), false);
        assert.throws(() => require(path.join(f.core, 'application/lock')).acquire(), { code: 'BUSY' });
        assert.throws(() => a.dispatch('storage-clean', { retentionDays: 30, selection: [{ jobId: jobs[0].jobId, fingerprint: 'a'.repeat(64) }] }), { code: 'BUSY' });
        assert.equal(fs.readFileSync(path.join(f.source, '0.pack'), 'utf8'), 'PACK:' + 'test'.repeat(100));
    } finally { gate.open(); }
    for (const job of jobs) { await until(() => a.status(job.jobId).done); assert.equal(a.status(job.jobId).exitCode, 0); }
    const firstExit = Math.min(...jobs.slice(0, 2).map(job => fs.statSync(path.join(jobDir(f, job.jobId), 'exit.json')).mtimeMs));
    assert.ok(firstExit <= fs.statSync(path.join(jobDir(f, jobs[2].jobId), 'dispatch.json')).mtimeMs);
});

test('resource plans cover aliases, parent directories, outputs, backups, provider updates and observation reads', t => {
    const f = fixture(t), { plan, conflicts } = require(path.join(f.core, 'application/resources'));
    const normal = plan(f.request), second = plan({ ...f.request, outputDir: f.output + '-second' });
    assert.equal(conflicts(normal, second), false);
    assert.equal(conflicts(normal, plan({ ...f.request, outputDir: path.join(f.output, 'child') })), true);
    const alias = path.join(f.root, 'alias'); fs.symlinkSync(f.source, alias, 'junction');
    const overwrite = { mode: 'process', folder: alias, backupDir: f.backup, pipeline: f.request.pipeline };
    assert.equal(conflicts(normal, plan(overwrite)), true);
    const sibling = path.join(f.root, 'other'); fs.mkdirSync(sibling);
    assert.equal(conflicts(plan(overwrite), plan({ ...overwrite, folder: sibling })), true);
    assert.equal(conflicts(normal, plan({ mode: 'dependency-install', providerId: 'fixture' })), true);
    assert.equal(conflicts(normal, plan({ mode: 'dependency-install', providerId: 'sharp' })), false);
    const observation = plan({ mode: 'process', folder: f.source, pipeline: [{ enabled: true, operation: 'audio-analyze', provider: 'ffmpeg' }] });
    assert.equal(observation.entries.find(entry => entry.kind === 'path').access, 'read');
    assert.equal(conflicts(observation, plan(overwrite)), true);
    assert.equal(conflicts(observation, normal), false);
    assert.throws(() => plan({ ...f.request, outputDir: path.join(f.core, 'data/reports') }), { code: 'PATH_FORBIDDEN' });
});

test('conflicting waiters keep FIFO priority while unrelated resources fill idle slots', () => {
    const { schedule } = require('../application/resources');
    const item = (id, key, access, running = false) => ({ id, slot: running ? 1 : undefined, running, pending: true, resources: { schema: 'asset-toolbox.resources/1', entries: [{ kind: 'provider', key, access }] } });
    const result = schedule([item('reader', 'x', 'read', true), item('writer', 'x', 'write'), item('late-reader', 'x', 'read'), item('independent', 'y', 'write')]);
    assert.deepEqual(result.selected.map(item => item.id), ['independent']);
    assert.equal(result.reasons.get('writer'), 'resource-conflict');
    assert.equal(result.reasons.get('late-reader'), 'earlier-conflict');
    assert.deepEqual(schedule([item('writer', 'x', 'write'), item('late-reader', 'x', 'read')]).selected.map(item => item.id), ['writer']);
});

test('resume and restore reserve the task, source, output and backup sets', t => {
    const f = fixture(t), { plan, conflicts } = require(path.join(f.core, 'application/resources'));
    const prepared = require(path.join(f.core, 'engine')).prepareFolder(f.source, { pipeline: f.request.pipeline, backupDir: f.backup, fileList: [] });
    const task = require(path.join(f.core, 'tasks')).createTask(prepared);
    const request = mode => ({ mode, taskFile: path.join(f.core, 'data/tasks', task.header.id, 'task.json') });
    assert.equal(conflicts(plan(request('resume')), plan(request('restore'))), true);
    assert.equal(conflicts(plan(request('restore-preview')), plan(request('retry'))), true);
    assert.equal(conflicts(plan(request('restore-preview')), plan(request('restore-preview'))), false);
    assert.equal(conflicts(plan(request('restore')), plan(f.request)), true);
    const exportRequest = { mode: 'restore-export', backupDir: task.header.backupSession, outputDir: f.output };
    assert.equal(conflicts(plan(exportRequest), plan(f.request)), true);
});

test('spawn failure after dispatch releases the reservation without replay or queue deadlock', async t => {
    const f = fixture(t), original = f.service.session.start;
    f.service.session.start = () => { throw Error('模拟创建进程失败'); };
    const failed = f.service.submit({ ...f.request, mode: 'preview' }, 'spawn-fail');
    assert.equal((await f.until(failed.jobId)).exitCode, 1);
    assert.equal(fs.existsSync(path.join(jobDir(f, failed.jobId), 'exit.json')), true);
    f.service.session.start = original;
    const next = f.service.submit({ ...f.request, mode: 'preview' }, 'after-failure');
    assert.equal((await f.until(next.jobId)).exitCode, 0);
    assert.equal(f.service.submit({ ...f.request, mode: 'preview' }, 'spawn-fail').replayed, true);
});

test('automatic provider updates wait for live provider readers and can cancel without downloading', async t => {
    const f = fixture(t, { allowDependencyInstall: true });
    fs.mkdirSync(path.join(f.core, 'data/jobs/v5'), { recursive: true });
    const lock = require(path.join(f.core, 'application/lock'));
    const release = lock.acquireShared({ schema: 'asset-toolbox.resources/1', entries: [{ kind: 'provider', key: 'sharp', access: 'read' }] }, 'f'.repeat(64));
    try {
        const job = f.service.submit({ mode: 'dependency-install', providerId: 'sharp' }, 'update-sharp');
        await delay(250);
        assert.equal(f.service.status(job.jobId).waitReason, 'resource-conflict');
        assert.equal(fs.existsSync(path.join(jobDir(f, job.jobId), 'worker.json')), false);
        assert.equal(fs.existsSync(path.join(f.core, 'data/dependencies')), false);
        f.service.dispatch('cancel', { jobId: job.jobId });
        assert.equal(f.service.status(job.jobId).cancelled, true);
    } finally { release(); }
});

test('a dead owner record cannot release live worker resources, and an owner crash frees only exited workers', async t => {
    const { spawn, spawnSync } = require('node:child_process');
    const f = fixture(t, {}, 1), gate = gateProvider(t, f), service = local(t, f);
    const requestFile = path.join(f.root, 'child-request.json'); fs.writeFileSync(requestFile, JSON.stringify(f.request));
    const child = spawn(process.execPath, ['-e', `const fs=require('node:fs'),path=require('node:path');const {ApplicationService}=require(path.join(process.argv[1],'application/service'));const service=ApplicationService.forDesktop();console.log(JSON.stringify(service.submit(JSON.parse(fs.readFileSync(process.argv[2])),'orphan')));setInterval(()=>{},1000);`, f.core, requestFile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '', errors = ''; child.stdout.on('data', part => text += part); child.stderr.on('data', part => errors += part);
    const closed = new Promise(resolve => child.once('close', resolve));
    t.after(async () => { gate.open(); child.kill(); await closed; });
    let id, worker, queued;
    try {
        await until(() => text.includes('jobId')); id = JSON.parse(text.trim()).jobId;
        await until(() => gate.count() === 1);
        const dir = jobDir(f, id); worker = JSON.parse(fs.readFileSync(path.join(dir, 'worker.json')));
        // 先模拟已死亡的持有者记录及缺失 worker 身份，确定性验证活子进程的独立占用。
        const metaFile = path.join(dir, 'job.json'), meta = JSON.parse(fs.readFileSync(metaFile));
        const dead = spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid;
        fs.writeFileSync(metaFile, JSON.stringify({ ...meta, ownerPid: dead }));
        fs.unlinkSync(path.join(dir, 'worker.json'));
        assert.equal(errors, '');
        const response = await require(path.join(f.core, 'application/service')).respond(service, 'submit', { request: { ...f.request, mode: 'preview' }, idempotencyKey: 'after-orphan' });
        assert.equal(response.ok, true, JSON.stringify(response)); queued = response.result;
        await delay(250);
        assert.equal(require(path.join(f.core, 'application/lock')).alive(worker.pid), true);
        assert.equal(service.status(queued.jobId).waitReason, 'resource-conflict');
        assert.equal(fs.existsSync(path.join(jobDir(f, queued.jobId), 'dispatch.json')), false);
        assert.throws(() => require(path.join(f.core, 'application/lock')).acquire(), { code: 'BUSY' });
    } finally { child.kill(); gate.open(); await closed; }
    await until(() => service.status(queued.jobId).done);
    assert.equal(require(path.join(f.core, 'application/lock')).alive(worker.pid), false);
    assert.equal(service.status(queued.jobId).exitCode, 0);
    assert.equal(service.submit(f.request, 'orphan').replayed, true);
});

test('changed destination aliases fail before dispatch and unknown resource versions fail closed', async t => {
    const f = fixture(t), service = local(t, f), release = require(path.join(f.core, 'application/lock')).acquire();
    const queued = service.submit(f.request, 'alias-change');
    const target = path.join(f.root, 'new-target'); fs.mkdirSync(target); fs.symlinkSync(target, f.output, 'junction');
    release();
    await until(() => service.status(queued.jobId).done);
    assert.equal(service.status(queued.jobId).exitCode, 1);
    assert.equal(fs.existsSync(path.join(jobDir(f, queued.jobId), 'worker.json')), false);
    assert.deepEqual(fs.readdirSync(target), []);
    const metaFile = path.join(jobDir(f, queued.jobId), 'job.json'), meta = JSON.parse(fs.readFileSync(metaFile));
    meta.resources.schema = 'asset-toolbox.resources/0'; fs.writeFileSync(metaFile, JSON.stringify(meta));
    assert.throws(() => service.status(queued.jobId), { code: 'UNSUPPORTED_VERSION' });
});
