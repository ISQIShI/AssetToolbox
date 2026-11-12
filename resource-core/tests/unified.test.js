const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { copyTool } = require('./portable');
const { installType } = require('./helpers');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(t) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-unified-'));
    const tool = copyTool(root), core = path.join(tool, 'resource-core'); installType(tool, 'fixture');
    const provider = path.join(core, 'providers/fixture'); fs.mkdirSync(provider);
    fs.writeFileSync(path.join(provider, 'index.js'), `const fs=require('node:fs');module.exports={apiVersion:2,version:'1.0.0',displayName:'统一契约测试',adapters:{compress:{version:'1.0.0',resourceTypes:['fixture'],execute({input,output}){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120);fs.writeFileSync(output,fs.readFileSync(input).subarray(0,8));return{output};}}}};`);
    const source = path.join(root, '素材'), output = path.join(root, '结果'); fs.mkdirSync(source);
    for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(source, i + '.pack'), 'PACK:' + 'test'.repeat(100));
    const policy = path.join(root, 'policy.json'); fs.writeFileSync(policy, JSON.stringify({ schema: 'asset-toolbox.automation-policy/1', sourceRoots: [source], outputRoots: [output], backupRoots: [] }));
    const { ApplicationService, respond } = require(path.join(core, 'application/service'));
    const { policyContext, localContext } = require(path.join(core, 'application/context'));
    const local = new ApplicationService(localContext()), server = new ApplicationService(policyContext(policy, 'server'));
    t.after(async () => { await local.shutdown(); await server.shutdown(); assert.equal(path.dirname(fs.realpathSync(root)), parent); assert.ok(path.basename(root).startsWith('asset-unified-')); fs.rmSync(root, { recursive: true, force: true }); });
    const request = { mode: 'process', folder: source, outputDir: output, pipeline: [{ id: 'fixture', resourceType: 'fixture', operation: 'compress', provider: 'fixture', enabled: true }] };
    const until = async (jobId, predicate = state => state.done) => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) { const state = local.dispatch('status', { jobId }); if (predicate(state)) return state; await delay(20); }
        throw new Error('统一作业等待超时');
    };
    return { root, core, source, output, policy, ApplicationService, respond, localContext, policyContext, local, server, request, until };
}

test('contexts govern disconnect and ownership without a separate desktop execution path', async t => {
    const f = fixture(t), { jobId } = f.server.dispatch('submit', { request: f.request, idempotencyKey: 'server-job' });
    await f.until(jobId, state => state.processed >= 1);
    await f.server.disconnect();
    // 关闭只查询过作业的本地上下文，不能取消其他上下文拥有的工作进程。
    const observer = new f.ApplicationService(f.localContext()); observer.dispatch('status', { jobId }); await observer.disconnect();
    const complete = await f.until(jobId); assert.equal(complete.exitCode, 0); assert.equal(complete.task.completed, 8);
    const source2 = path.join(f.root, '另一批素材'); fs.mkdirSync(source2);
    for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(source2, i + '.pack'), 'PACK:' + 'next'.repeat(100));
    const next = f.local.dispatch('submit', { request: { ...f.request, folder: source2, outputDir: path.join(f.root, '另一批结果') }, idempotencyKey: 'local-job' });
    await f.until(next.jobId, state => state.processed >= 1); await f.local.disconnect();
    const cancelled = await f.until(next.jobId); assert.equal(cancelled.cancelled, true); assert.ok(cancelled.task.completed < 8);
    assert.equal(f.local.dispatch('jobs').items.length, 2);
    assert.equal(f.server.dispatch('jobs').items.length, 1);
    assert.throws(() => f.server.dispatch('status', { jobId: next.jobId }), { code: 'PATH_FORBIDDEN' });
});

test('all common actions use one validation contract; contexts cannot be injected and old job versions are refused', async t => {
    const f = fixture(t), { DesktopBridge } = require(path.join(f.core, 'desktop-bridge'));
    const bridge = new DesktopBridge(f.policyContext(f.policy)); t.after(() => bridge.shutdown());
    for (const [action, input] of [['submit', { request: f.request }], ['status', { jobId: '../escape' }], ['validate', { request: { ...f.request, _automationPolicy: {} } }], ['submit', { request: f.request, idempotencyKey: 'x', context: { local: true } }]]) {
        const expected = await f.respond(f.local, action, input);
        assert.equal(expected.ok, false);
        assert.deepEqual(await f.respond(bridge, action, input), expected);
        assert.deepEqual(await f.respond(f.server, action, input), expected);
    }
    assert.throws(() => new f.ApplicationService({ settings: true, policy: null }), /上下文/);
    assert.throws(() => f.local.dispatch('start', f.request), { code: 'INVALID_REQUEST' });
    await assert.rejects(bridge.dispatch('save', {}), /未授权/);
    const { jobId } = f.local.submit({ ...f.request, mode: 'preview' }, 'version-test'); await f.until(jobId);
    const filename = path.join(f.local.directory, jobId, 'job.json'), meta = JSON.parse(fs.readFileSync(filename));
    fs.writeFileSync(filename, JSON.stringify({ ...meta, schema: 'asset-toolbox.job/1' }));
    assert.throws(() => f.local.dispatch('status', { jobId }), { code: 'UNSUPPORTED_VERSION' });
    assert.equal(fs.existsSync(path.join(f.core, 'data/automation')), false);
});

test('server shutdown cancels only its own active job and leaves durable cross-context results', async t => {
    const f = fixture(t), { jobId } = f.server.submit(f.request, 'shutdown');
    await f.until(jobId, state => state.processed >= 1); await f.server.shutdown();
    const state = await f.until(jobId); assert.equal(state.cancelled, true); assert.ok(state.task.completed < 8);
    const resumed = f.local.submit({ mode: 'resume', taskId: state.taskId }, 'resume');
    assert.equal((await f.until(resumed.jobId)).task.completed, 8);
    const reconnected = new f.ApplicationService(f.policyContext(f.policy)); t.after(() => reconnected.shutdown());
    assert.deepEqual(reconnected.dispatch('results', { jobId: resumed.jobId }), f.local.dispatch('results', { jobId: resumed.jobId }));
    assert.equal(fs.readFileSync(path.join(f.source, '0.pack'), 'utf8'), 'PACK:' + 'test'.repeat(100));
});

test('shortcut CLI adapts into durable jobs and keeps provider loading logs out of JSON stdout', async t => {
    const f = fixture(t), provider = path.join(f.core, 'providers/fixture/index.js');
    fs.writeFileSync(provider, "console.log('提供方加载诊断');\n" + fs.readFileSync(provider, 'utf8'));
    const pipeline = path.join(f.root, 'pipeline.json'); fs.writeFileSync(pipeline, JSON.stringify(f.request.pipeline));
    const result = spawnSync(process.execPath, [path.join(f.core, 'cli.js'), f.source, '--pipeline', pipeline, '--output', f.output], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, result.stderr); assert.match(result.stderr, /提供方加载诊断/);
    const response = JSON.parse(result.stdout); assert.equal(response.schema, 'asset-toolbox.response/4');
    assert.equal(response.result.state.task.completed, 8);
    assert.equal(f.server.dispatch('status', { jobId: response.result.jobId }).taskId, response.result.state.taskId);
    assert.equal(fs.readFileSync(path.join(f.source, '0.pack'), 'utf8'), 'PACK:' + 'test'.repeat(100));
});
