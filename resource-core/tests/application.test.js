const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync, spawn } = require('node:child_process');
const { copyTool } = require('./portable');
const { installType } = require('./helpers');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const { fixture } = require('./fixtures/application');

test('application discovers live adapter schemas; validates scopes, unknown keys, versions and source preservation', async t => {
    const f = fixture(t);
    const catalog = (await f.call('capabilities')).result;
    assert.equal(catalog.applicationApi, 'asset-toolbox.application/8');
    assert.equal(catalog.operations.find(op => op.id === 'image-resize').parametersSchema.properties.width.minimum, 1);
    assert.ok(catalog.providers.find(p => p.id === 'ffmpeg').acquisition.instructions);
    assert.equal((await f.call('validate', { request: f.request })).ok, true);
    const { outputDir, ...overwrite } = f.request;
    for (const request of [overwrite, { ...overwrite, backupDir: f.backup }]) assert.equal((await f.call('validate', { request })).error.code, 'PERMISSION_DENIED');
    assert.equal((await f.call('validate', { request: { ...f.request, outputDir: f.root } })).error.code, 'PATH_FORBIDDEN');
    assert.equal((await f.call('validate', { request: { ...f.request, allowOverwrite: true } })).error.code, 'INVALID_REQUEST');
    assert.equal((await f.call('validate', { request: { ...f.request, pipeline: [{ ...f.request.pipeline[0], versions: {} }] } })).ok, false);
    assert.equal(fs.existsSync(path.join(f.core, 'data')), false);
});

test('submit is durable and idempotent, reports paginate and tasks are shared with desktop without changing settings', async t => {
    const f = fixture(t);
    const started = f.service.submit(f.request, 'same-key');
    const repeated = f.service.submit(f.request, 'same-key');
    assert.equal(repeated.jobId, started.jobId); assert.equal(repeated.replayed, true);
    const state = await f.until(started.jobId); assert.equal(state.exitCode, 0); assert.equal(state.task.completed, 4);
    const reopened = new f.ApplicationService(f.policyFile);
    assert.equal(reopened.submit(f.request, 'same-key').replayed, true);
    const first = reopened.results(started.jobId, 'files', { limit: 2 });
    assert.equal(first.items.length, 2); assert.equal(first.total, 4); assert.equal(first.nextOffset, 2);
    assert.equal(reopened.results(started.jobId, 'files', { offset: 2, limit: 2 }).nextOffset, null);
    assert.throws(() => reopened.results(started.jobId, 'files', { limit: 101 }), { code: 'INVALID_REQUEST' });
    assert.equal((await f.call('tasks')).result.items[0].id, state.taskId);
    assert.equal(require(path.join(f.core, 'tasks')).listTasks().length, 1);
    assert.equal(fs.existsSync(path.join(f.core, 'data/settings.json')), false);
    assert.throws(() => f.service.submit({ ...f.request, pipeline: [] }, 'same-key'), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.equal(fs.readFileSync(path.join(f.source, '0.pack'), 'utf8').length, 405);
    assert.equal(fs.readFileSync(path.join(f.output, '0.pack'), 'utf8').length, 8);
    const malicious = await f.call('submit', { request: { mode: 'resume', taskId: '../task.json' }, idempotencyKey: 'escape' });
    assert.equal(malicious.error.code, 'INVALID_REQUEST');
});

test('cancellation, restart, resume and explicit hash-selected restore reuse existing safety contracts', async t => {
    const f = fixture(t, { allowOverwrite: true, allowRestore: true }, 8, 100);
    const { outputDir, ...request } = f.request;
    const { jobId } = f.service.submit({ ...request, backupDir: f.backup }, 'overwrite');
    await f.until(jobId, state => state.processed >= 1);
    await f.call('cancel', { jobId });
    const stopped = await f.until(jobId); assert.equal(stopped.cancelled, true); assert.ok(stopped.task.completed < 8);
    const resumed = f.service.submit({ mode: 'resume', taskId: stopped.taskId }, 'resume');
    const complete = await f.until(resumed.jobId); assert.equal(complete.task.completed, 8);
    const preview = f.service.submit({ mode: 'restore-preview', taskId: stopped.taskId }, 'restore-preview');
    assert.equal((await f.until(preview.jobId)).exitCode, 0);
    const row = f.service.results(preview.jobId, 'restore', {}).items[0];
    assert.throws(() => f.service.submit({ mode: 'restore', taskId: stopped.taskId }, 'unsafe'), { code: 'INVALID_REQUEST' });
    const selection = [{ path: row.path, backupHash: row.backupHash, targetHash: row.targetHash }];
    const restore = f.service.submit({ mode: 'restore', taskId: stopped.taskId, selection }, 'restore');
    assert.equal((await f.until(restore.jobId)).summary.restored, 1);
    assert.equal(fs.readFileSync(path.join(f.source, row.path), 'utf8').length, 405);
    const exportedPreview = f.service.submit({ mode: 'restore-export-preview', backupDir: complete.task.backupSession, outputDir: f.output }, 'export-preview');
    assert.equal((await f.until(exportedPreview.jobId)).exitCode, 0);
    const exportRow = f.service.results(exportedPreview.jobId, 'restore', {}).items[0];
    const exported = f.service.submit({ mode: 'restore-export', backupDir: complete.task.backupSession, outputDir: f.output, selection: [{ path: exportRow.path, backupHash: exportRow.backupHash, targetHash: exportRow.targetHash }] }, 'export');
    assert.equal((await f.until(exported.jobId)).summary.restored, 1);
    assert.equal(fs.readFileSync(path.join(f.output, exportRow.path), 'utf8').length, 405);
});

test('CLI JSON responses persist across invocations; invalid JSON and missing dependencies fail without mutation', async t => {
    const f = fixture(t);
    const input = path.join(f.root, 'input.json'); fs.writeFileSync(input, JSON.stringify({ request: f.request, idempotencyKey: 'cli' }));
    const command = [path.join(f.core, 'cli.js'), 'api', 'submit', '--policy', f.policyFile, '--input', input];
    const result = spawnSync(process.execPath, command, { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); const response = JSON.parse(result.stdout);
    assert.equal(response.result.state.task.completed, 4);
    const replay = spawnSync(process.execPath, command, { encoding: 'utf8', windowsHide: true });
    assert.equal(JSON.parse(replay.stdout).result.replayed, true);
    fs.writeFileSync(input, '{');
    const invalid = spawnSync(process.execPath, command, { encoding: 'utf8', windowsHide: true });
    assert.equal(invalid.status, 1); assert.equal(JSON.parse(invalid.stdout).ok, false);
    fs.rmSync(path.join(f.core, 'providers/pngquant/pngquant.exe'), { force: true });
    const pipeline = [{ ...f.request.pipeline[0], resourceType: 'png', provider: 'pngquant' }];
    assert.equal((await f.call('submit', { request: { ...f.request, pipeline }, idempotencyKey: 'missing' })).error.code, 'DEPENDENCY_MISSING');
    assert.equal((await f.call('submit', { request: { mode: 'dependency-install', providerId: 'lame' }, idempotencyKey: 'install' })).error.code, 'PERMISSION_DENIED');
});

test('desktop and external jobs contend on the same process lock; stale owners can be recovered', async t => {
    const f = fixture(t, {}, 8, 150);
    const { DesktopBridge } = require(path.join(f.core, 'desktop-bridge'));
    const bridge = new DesktopBridge(); t.after(() => bridge.shutdown());
    const { jobId } = f.service.submit(f.request, 'active');
    await f.until(jobId, state => state.processed >= 1);
    const other = await bridge.dispatch('submit', { request: { ...f.request, mode: 'preview' }, idempotencyKey: 'competing' });
    assert.equal((await bridge.dispatch('status', { jobId: other.jobId })).phase, 'queued');
    while (!(await bridge.dispatch('status', { jobId: other.jobId })).done) await delay(20);
    assert.equal((await bridge.dispatch('status', { jobId: other.jobId })).exitCode, 0);
    await f.until(jobId);
    const lockModule = path.join(f.core, 'application/lock');
    const child = spawn(process.execPath, ['-e', `const end=Date.now()+5000;for(;;){try{require(${JSON.stringify(lockModule)}).acquire();break;}catch(error){if(error.code!=='BUSY'||Date.now()>=end)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}}process.stdout.write('locked');setInterval(()=>{},1000);`], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const closed = new Promise(resolve => child.once('close', resolve));
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('测试锁拥有者启动超时')), 10000);
            child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
            child.once('close', code => { clearTimeout(timer); reject(Error('测试锁拥有者提前退出：' + code)); });
        });
    } finally { child.kill(); await closed; }
    const unlock = require(lockModule).acquire(); unlock();
});

test('symlink escapes and changed scopes cannot access jobs or redirect writes', async t => {
    const f = fixture(t);
    const outside = path.join(f.root, '外部'); fs.mkdirSync(outside);
    fs.mkdirSync(f.output);
    const linked = path.join(f.output, 'escape'); fs.symlinkSync(outside, linked, 'junction');
    assert.equal((await f.call('validate', { request: { ...f.request, outputDir: linked } })).error.code, 'PATH_FORBIDDEN');
    const { jobId } = f.service.submit({ ...f.request, mode: 'preview' }, 'preview');
    await f.until(jobId);
    const policy = JSON.parse(fs.readFileSync(f.policyFile)); policy.allowRestore = true; fs.writeFileSync(f.policyFile, JSON.stringify(policy));
    assert.equal(new f.ApplicationService(f.policyFile).status(jobId).done, true);
    const denied = { ...policy, sourceRoots: [] }; fs.writeFileSync(f.policyFile, JSON.stringify(denied));
    assert.throws(() => new f.ApplicationService(f.policyFile).status(jobId), { code: 'PATH_FORBIDDEN' });
    fs.unlinkSync(linked); fs.rmdirSync(f.output); fs.symlinkSync(outside, f.output, 'junction');
    assert.throws(() => f.service.status(jobId), { code: 'PATH_FORBIDDEN' });
});


test('dependency install cannot race a running GUI/CLI worker and rejects arbitrary installation fields', async t => {
    const f = fixture(t, { allowDependencyInstall: true });
    assert.equal((await f.call('validate', { request: { mode: 'dependency-install', providerId: 'lame', url: 'https://example.com/tool.exe' } })).error.code, 'INVALID_REQUEST');
    assert.equal((await f.call('validate', { request: { mode: 'dependency-install', providerId: 'ffmpeg' } })).error.code, 'MANUAL_INSTALL_REQUIRED');
    const unlock = require(path.join(f.core, 'application/lock')).acquire();
    try {
        const { jobId } = f.service.submit({ mode: 'dependency-install', providerId: 'lame' }, 'busy-install');
        await delay(250);
        assert.equal(f.service.status(jobId).phase, 'queued');
        f.service.dispatch('cancel', { jobId });
        const state = await f.until(jobId); assert.equal(state.cancelled, true); assert.equal(state.exitCode, 2);
        assert.equal(fs.existsSync(path.join(f.core, 'data/dependencies')), false);
    } finally { unlock(); }
});

test('two independent clients replay one submission; a hard-killed process tree resumes from its journal', async t => {
    const f = fixture(t, {}, 12, 120);
    const input = path.join(f.root, 'request.json'); fs.writeFileSync(input, JSON.stringify({ request: f.request, idempotencyKey: 'cross-process' }));
    const command = [path.join(f.core, 'cli.js'), 'api', 'submit', '--policy', f.policyFile, '--input', input];
    const child = spawn(process.execPath, command, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise(resolve => child.once('close', resolve));
    let errorOutput = '';
    const receipt = await new Promise((resolve, reject) => {
        child.stderr.on('data', bytes => { errorOutput += bytes; const first = errorOutput.split('\n')[0]; try { resolve(JSON.parse(first)); } catch {} });
        child.once('error', reject);
        child.once('close', () => reject(new Error(errorOutput || '启动失败')));
    });
    const replay = f.service.submit(f.request, 'cross-process'); assert.equal(replay.jobId, receipt.jobId); assert.equal(replay.replayed, true);
    await f.until(receipt.jobId, state => state.processed >= 1);
    child.kill(); await exited;
    const stopped = await f.until(receipt.jobId);
    // Windows 强杀可能一起终止工作进程；应报告中断，不能伪装成正常取消。
    assert.ok(stopped.cancelled || stopped.errorCode === 'INTERRUPTED', JSON.stringify(stopped));
    assert.ok(stopped.task.completed > 0 && stopped.task.completed < 12);
    assert.equal(require(path.join(f.core, 'tasks')).listTasks().length, 1);
    const resumed = f.service.submit({ mode: 'resume', taskId: stopped.taskId }, 'after-crash');
    const finished = await f.until(resumed.jobId);
    assert.equal(finished.exitCode, 0); assert.equal(finished.task.completed, 12);
    assert.ok(finished.summary.processed <= 12 - stopped.task.completed);
    for (let i = 0; i < 12; i++) {
        assert.equal(fs.readFileSync(path.join(f.source, i + '.pack'), 'utf8'), 'PACK:' + 'test'.repeat(100));
        assert.equal(fs.readFileSync(path.join(f.output, i + '.pack'), 'utf8'), 'PACK:tes');
    }
});
