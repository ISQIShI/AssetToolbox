const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const { fixture } = require('./fixtures/application');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate) { const end = Date.now() + 15000; while (Date.now() < end) { if (await predicate()) return; await delay(30); } throw Error('服务状态等待超时'); }
const settings = f => ({ port: 0, mcp: false, policy: f.service.policy });
test('shared service actions configure, start, query, export and stop via authenticated HTTP without transferring ownership', async t => {
    const f = fixture(t, { allowServiceManagement: true }, 10, 70), local = f.ApplicationService.forDesktop();
    try {
        assert.equal(local.dispatch('service-status').configured, false);
        local.dispatch('service-configure', settings(f));
        const exported = f.service.dispatch('service-client-config', { transport: 'stdio' });
        assert.ok(exported.mcpServers['asset-toolbox'].args.includes('--policy'));
        const started = await local.dispatch('service-start'), secret = fs.readFileSync(started.tokenFile, 'utf8').trim();
        assert.equal(started.state, 'running'); assert.equal(started.owned, true); assert.equal(JSON.stringify(started).includes(secret), false);
        const api = async (action, input = {}) => { const response = await fetch(started.endpoints.apiUrl + action, { method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); return { status: response.status, body: await response.json() }; };
        assert.equal((await api('service-status')).body.result.owned, false);
        assert.equal((await api('service-start')).body.result.reused, true);
        assert.equal((await api('service-configure', settings(f))).status, 409);
        assert.equal((await api('service-client-config', { transport: 'http' })).body.result.apiUrl, started.endpoints.apiUrl);
        await f.service.disconnect(); // 观察者不接管或关闭桌面拥有的服务。
        assert.equal(local.dispatch('service-status').state, 'running');
        const other = local.submit({ ...f.request, outputDir: f.output + '-local' }, 'local-keeps-running');
        const submitted = await api('submit', { request: f.request, idempotencyKey: 'service-stops-owned-work' });
        assert.equal(submitted.body.ok, true);
        await until(async () => (await api('status', { jobId: submitted.body.result.jobId })).body.result.processed >= 1);
        assert.equal((await api('service-stop')).body.result.requested, true);
        await until(() => local.dispatch('service-status').state === 'stopped');
        assert.equal(local.status(submitted.body.result.jobId).cancelled, true);
        await until(() => local.status(other.jobId).done); assert.equal(local.status(other.jobId).exitCode, 0, JSON.stringify(local.status(other.jobId)));
        await assert.rejects(fetch(started.endpoints.healthUrl));
        await local.dispatch('service-start'); await local.shutdown();
        assert.equal(local.dispatch('service-status').state, 'stopped');
    } finally { await local.shutdown(); }
});
test('service management is separately authorized, cannot widen policy, and rejects unsafe configuration storage', async t => {
    const f = fixture(t), local = f.ApplicationService.forDesktop();
    const originalPolicy = fs.readFileSync(f.policyFile, 'utf8');
    fs.writeFileSync(f.policyFile, originalPolicy.replace('automation-policy/2', 'automation-policy/1'));
    assert.throws(() => new f.ApplicationService(f.policyFile), { code: 'UNSUPPORTED_VERSION' });
    fs.writeFileSync(f.policyFile, originalPolicy);
    local.dispatch('service-configure', settings(f));
    for (const action of ['service-status', 'service-start', 'service-stop', 'service-client-config', 'service-configure']) {
        const response = await f.call(action, action === 'service-client-config' ? { transport: 'stdio' } : action === 'service-configure' ? settings(f) : {});
        assert.equal(response.error.code, 'PERMISSION_DENIED');
    }
    const before = fs.readFileSync(path.join(f.core, 'data/services/token.txt'), 'utf8');
    const allowed = { ...f.service.policy, allowServiceManagement: true };
    local.dispatch('service-configure', { ...settings(f), policy: allowed });
    assert.notEqual(fs.readFileSync(path.join(f.core, 'data/services/token.txt'), 'utf8'), before);
    fs.writeFileSync(f.policyFile, JSON.stringify(allowed)); const agent = new f.ApplicationService(f.policyFile);
    try {
        assert.equal(agent.dispatch('service-configure', { ...settings(f), policy: allowed, port: 12345 }).config.port, 12345);
        assert.throws(() => agent.dispatch('service-configure', { ...settings(f), policy: { ...allowed, sourceRoots: [f.root] } }), { code: 'PERMISSION_DENIED' });
        assert.throws(() => local.dispatch('service-configure', { ...settings(f), port: 65536 }), { code: 'INVALID_REQUEST' });
        const cfg = path.join(f.core, 'data/services/config.json'); fs.writeFileSync(cfg, '{"schema":"asset-toolbox.services/0"}');
        assert.throws(() => local.dispatch('service-status'), { code: 'UNSUPPORTED_VERSION' });
        fs.unlinkSync(cfg); const outside = path.join(f.root, 'outside'); fs.writeFileSync(outside, '{}'); fs.linkSync(outside, cfg);
        assert.throws(() => local.dispatch('service-configure', settings(f)), { code: 'PATH_FORBIDDEN' });
        assert.equal(fs.readFileSync(outside, 'utf8'), '{}');
    } finally { await agent.shutdown(); await local.shutdown(); }
});
test('CLI service command holds the owner process and another CLI stops it through the same application actions', async t => {
    const f = fixture(t), local = f.ApplicationService.forDesktop(); local.dispatch('service-configure', settings(f));
    const cli = path.join(f.core, 'cli.js');
    const child = spawn(process.execPath, [cli, 'service', 'start', '--local'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
    try {
        await until(() => output.includes('\n')); const result = JSON.parse(output); assert.equal(result.ok, true, errors);
        assert.equal(child.exitCode, null);
        const stopped = spawnSync(process.execPath, [cli, 'service', 'stop', '--local'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
        assert.equal(stopped.status, 0, stopped.stderr); assert.equal(JSON.parse(stopped.stdout).result.requested, true);
        await until(() => child.exitCode !== null); assert.equal(child.exitCode, 0, errors);
        await assert.rejects(fetch(result.result.endpoints.healthUrl));
    } finally { if (child.exitCode === null) { local.dispatch('service-stop'); await until(() => child.exitCode !== null); } await local.shutdown(); }
});
test('missing MCP fails cleanly, simultaneous starts reuse one listener, and exit during startup leaves no listener', async t => {
    const f = fixture(t), local = f.ApplicationService.forDesktop(), peer = f.ApplicationService.forDesktop();
    try {
        local.dispatch('service-configure', { ...settings(f), mcp: true });
        await assert.rejects(local.dispatch('service-start'), { code: 'DEPENDENCY_MISSING' });
        assert.equal(local.dispatch('service-status').state, 'stopped');
        local.dispatch('service-configure', settings(f));
        const { respond } = require(path.join(f.core, 'application/service'));
        const results = await Promise.all([respond(local, 'service-start', {}), respond(peer, 'service-start', {})]);
        assert.ok(results.every(result => result.ok));
        assert.equal(results.filter(result => !result.result.reused).length, 1);
        assert.deepEqual(results[0].result.endpoints, results[1].result.endpoints);
        await local.shutdown(); await peer.shutdown();
        const pending = f.service; // policy 没有管理权限，退出后也不能启动。
        await assert.rejects(pending.dispatch('service-start'), { code: 'PERMISSION_DENIED' });
        const closing = f.ApplicationService.forDesktop();
        const start = closing.dispatch('service-start'); const stop = closing.shutdown();
        await assert.rejects(start, { code: 'BUSY' }); await stop;
        assert.equal(closing.dispatch('service-status').state, 'stopped');
    } finally { await local.shutdown(); await peer.shutdown(); }
});
