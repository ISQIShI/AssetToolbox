const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');
const { test } = require('node:test');
const { copyTool } = require('./portable');
const { installType } = require('./helpers');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t, gated = false) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-http-'));
    const core = path.join(copyTool(root), 'resource-core');
    installType(path.dirname(core), 'fixture');
    const provider = path.join(core, 'providers/fixture'); fs.mkdirSync(provider);
    const gate = path.join(root, 'release-worker');
    const barrier = gated ? `if (++count === 2) { fs.writeFileSync(${JSON.stringify(gate + '.waiting')}, ''); const deadline = Date.now() + 20000; while (!fs.existsSync(${JSON.stringify(gate)})) { if (Date.now() > deadline) throw Error('测试同步超时'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10); } }` : '';
    fs.writeFileSync(path.join(provider, 'index.js'), `const fs=require('node:fs');let count=0;module.exports={apiVersion:2,version:'1.0.0',displayName:'HTTP 测试',adapters:{compress:{version:'1.0.0',resourceTypes:['fixture'],execute({input,output}){${barrier}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);fs.writeFileSync(output,fs.readFileSync(input).subarray(0,8));return {output};}}}};`);
    const source = path.join(root, '素材'), output = path.join(root, '结果'); fs.mkdirSync(source);
    for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(source, i + '.pack'), 'PACK:' + 'data'.repeat(100));
    const policyFile = path.join(root, 'policy.json');
    fs.writeFileSync(policyFile, JSON.stringify({ schema: 'asset-toolbox.automation-policy/1', sourceRoots: [source], outputRoots: [output], backupRoots: [] }));
    const { ApplicationService } = require(path.join(core, 'application/service'));
    const service = new ApplicationService(require(path.join(core, 'application/context')).policyContext(policyFile, 'server')), token = randomBytes(32).toString('base64url');
    const { createHttpServer } = require(path.join(core, 'application/http'));
    const server = createHttpServer({ service, token, port: 0 });
    const { url } = await server.listen();
    t.after(async () => { fs.writeFileSync(gate, ''); await server.close(); assert.equal(path.dirname(fs.realpathSync(root)), parent); assert.ok(path.basename(root).startsWith('asset-http-')); fs.rmSync(root, { recursive: true, force: true }); });
    const request = { mode: 'process', folder: source, outputDir: output, pipeline: [{ id: 'compress', resourceType: 'fixture', operation: 'compress', provider: 'fixture', enabled: true, parameters: {}, providerOptions: {} }] };
    const call = async (action, input = {}) => {
        const response = await fetch(url + '/api/v4/' + action, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        return { status: response.status, body: await response.json() };
    };
    const until = async (jobId, predicate = state => state.done) => {
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) { const { body } = await call('status', { jobId }); assert.equal(body.ok, true, JSON.stringify(body)); if (predicate(body.result)) return body.result; await delay(25); }
        throw new Error('HTTP 作业等待超时');
    };
    const waitForBoundary = async () => {
        const deadline = Date.now() + 15000;
        while (!fs.existsSync(gate + '.waiting')) { assert.ok(Date.now() < deadline, '工作进程未到达第二个文件'); await delay(25); }
    };
    return { root, core, source, output, policyFile, service, token, server, url, request, call, until, gate, waitForBoundary };
}
function raw(url, { headers = {}, body = '{}', method = 'POST', chunks } = {}) {
    return new Promise((resolve, reject) => {
        if (!chunks && !Object.hasOwn(headers, 'Content-Length')) headers = { ...headers, 'Content-Length': Buffer.byteLength(body) };
        const req = http.request(url, { method, headers }, res => {
            let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
        });
        req.on('error', reject);
        if (chunks) { for (const chunk of chunks) req.write(chunk); req.end(); } else req.end(body);
    });
}

test('HTTP requires token, correct Host and no browser Origin, and exposes only Agent actions', async t => {
    const f = await fixture(t), endpoint = f.url + '/api/v4/capabilities';
    assert.equal(f.server.server.address().address, '127.0.0.1');
    assert.equal((await raw(endpoint)).status, 401);
    assert.equal((await raw(endpoint, { headers: { Authorization: 'Bearer ' + 'x'.repeat(43) } })).status, 401);
    const headers = { Authorization: 'Bearer ' + f.token, 'Content-Type': 'application/json' };
    for (const origin of ['https://evil.example', 'null', f.url]) assert.equal((await raw(endpoint, { headers: { ...headers, Origin: origin } })).status, 403);
    assert.equal((await raw(endpoint, { headers: { ...headers, Host: 'evil.example' } })).status, 403);
    assert.equal((await raw(endpoint, { headers, method: 'GET' })).status, 405);
    assert.equal((await raw(endpoint, { headers, method: 'OPTIONS' })).status, 405);
    const discovered = await f.call('capabilities'); assert.equal(discovered.status, 200); assert.equal(discovered.body.result.apiVersion, 3);
    assert.equal((await f.call('bootstrap')).status, 404); assert.equal((await f.call('save')).status, 404);
    const oldApi = await raw(f.url + '/api/v1/capabilities', { headers });
    assert.equal(oldApi.status, 410); assert.equal(JSON.parse(oldApi.text).error.code, 'UNSUPPORTED_VERSION');
    assert.equal((await raw(f.url + '/api/v2/capabilities', { headers })).status, 410);
    assert.equal((await raw(f.url + '/api/v3/capabilities', { headers })).status, 410);
    assert.equal((await f.call('storage-preview')).status, 403);
    assert.equal((await f.call('storage-clean', { retentionDays: 30, selection: [{ jobId: 'a'.repeat(64), fingerprint: 'b'.repeat(64) }] })).status, 403);
    assert.equal((await f.call('validate', { request: f.request, desktop: true })).status, 400);
    assert.equal((await f.call('validate', { request: { ...f.request, outputDir: f.root } })).status, 403);
    assert.equal((await f.call('status', { jobId: '0'.repeat(64) })).status, 404);
    const health = await raw(f.url + '/health', { headers, method: 'GET', body: '' });
    assert.equal(health.status, 200); assert.equal(health.headers['cache-control'], 'no-store'); assert.equal(JSON.parse(health.text).result.mcp, false);
});

test('HTTP rejects malformed, oversized and compressed inputs before application dispatch', async t => {
    const f = await fixture(t), endpoint = f.url + '/api/v4/capabilities';
    const headers = { Authorization: 'Bearer ' + f.token, 'Content-Type': 'application/json' };
    assert.equal((await raw(endpoint, { headers, body: '{' })).status, 400);
    assert.equal((await raw(endpoint, { headers, body: Buffer.from([0xff]) })).status, 400);
    assert.equal((await raw(endpoint, { headers: { ...headers, 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await raw(endpoint, { headers: { ...headers, 'Content-Encoding': 'gzip' } })).status, 415);
    assert.equal((await raw(endpoint, { headers: { ...headers, 'Content-Length': 1024 * 1024 + 1 }, body: '' })).status, 413);
    assert.equal((await raw(endpoint, { headers, chunks: ['"', 'x'.repeat(1024 * 1024), '"'] })).status, 413);
    assert.equal((await f.call('capabilities', [])).status, 400);
    assert.equal((await f.call('capabilities')).status, 200);
    assert.equal(fs.existsSync(path.join(f.core, 'data/jobs/v3')), false);
});

test('HTTP submit survives request completion, shares idempotency with CLI and returns paginated results', async t => {
    const f = await fixture(t), submitted = await f.call('submit', { request: f.request, idempotencyKey: 'http-job' });
    assert.equal(submitted.status, 202); const { jobId } = submitted.body.result;
    assert.equal((await f.call('submit', { request: f.request, idempotencyKey: 'http-job' })).body.result.replayed, true);
    assert.equal((await f.call('submit', { request: { ...f.request, pipeline: [] }, idempotencyKey: 'http-job' })).status, 409);
    assert.equal((await f.call('results', { jobId })).status, 409);
    const done = await f.until(jobId); assert.equal(done.exitCode, 0); assert.equal(done.task.completed, 8);
    const first = await f.call('results', { jobId, limit: 3 }); assert.equal(first.body.result.items.length, 3); assert.equal(first.body.result.nextOffset, 3);
    const input = path.join(f.root, 'cli.json'); fs.writeFileSync(input, JSON.stringify({ request: f.request, idempotencyKey: 'http-job' }));
    const cli = spawnSync(process.execPath, [path.join(f.core, 'cli.js'), 'api', 'submit', '--policy', f.policyFile, '--input', input], { encoding: 'utf8', windowsHide: true });
    assert.equal(cli.status, 0, cli.stderr); assert.equal(JSON.parse(cli.stdout).result.replayed, true);
    assert.equal((await f.call('tasks')).body.result.items.length, 1);
    assert.equal(fs.readFileSync(path.join(f.source, '0.pack'), 'utf8'), 'PACK:' + 'data'.repeat(100));
    assert.equal(fs.readFileSync(path.join(f.output, '0.pack'), 'utf8'), 'PACK:dat');
});

test('HTTP cancellation and graceful server shutdown keep resumable task journals', async t => {
    const f = await fixture(t, true), { body } = await f.call('submit', { request: f.request, idempotencyKey: 'cancel' }); const { jobId } = body.result;
    await f.waitForBoundary();
    assert.equal((await f.call('cancel', { jobId })).status, 200);
    fs.writeFileSync(f.gate, '');
    const stopped = await f.until(jobId); assert.equal(stopped.cancelled, true); assert.ok(stopped.task.completed < 8);
    fs.unlinkSync(f.gate);
    fs.unlinkSync(f.gate + '.waiting');
    const resumed = await f.call('submit', { request: { mode: 'resume', taskId: stopped.taskId }, idempotencyKey: 'resume' });
    await f.waitForBoundary();
    const closing = f.server.close();
    fs.writeFileSync(f.gate, '');
    await closing;
    const final = f.service.status(resumed.body.result.jobId); assert.equal(final.done, true); assert.equal(final.cancelled, true);
    const tasks = require(path.join(f.core, 'tasks')).listTasks(); assert.equal(tasks[0].canResume, true);
    const release = require(path.join(f.core, 'application/lock')).acquire(); release();
});

test('token generation never prints or overwrites credentials; startup rejects public binding and unsafe desktop context', async t => {
    const f = await fixture(t), filename = path.join(f.root, 'token.txt');
    const { createToken } = require(path.join(f.core, 'application/token'));
    assert.deepEqual(createToken(filename), { created: true }); const before = fs.readFileSync(filename, 'utf8');
    assert.equal(before.trim().length, 43); assert.throws(() => createToken(filename), { code: 'EEXIST' }); assert.equal(fs.readFileSync(filename, 'utf8'), before);
    const { serverOptions } = require(path.join(f.core, 'application/server-options'));
    assert.throws(() => serverOptions(['--policy', f.policyFile, '--transport', 'http']), /token-file/);
    assert.throws(() => serverOptions(['--policy', f.policyFile, '--host', '0.0.0.0']), /无效/);
    assert.throws(() => serverOptions(['--policy', f.policyFile, '--port', '8787']), /仅用于/);
    assert.equal(serverOptions(['--policy', f.policyFile]).transport, 'stdio');
    const { ApplicationService } = require(path.join(f.core, 'application/service'));
    assert.throws(() => require(path.join(f.core, 'application/http')).createHttpServer({ service: ApplicationService.forDesktop(), token: f.token }), /policy/);
});

test('standalone HTTP entry needs no MCP package; occupied ports fail cleanly without changing jobs', async t => {
    const f = await fixture(t), tokenFile = path.join(f.root, 'token.txt'); fs.writeFileSync(tokenFile, f.token);
    const script = path.join(f.core, 'application/http-server.js');
    const args = [script, '--policy', f.policyFile, '--token-file', tokenFile, '--port'];
    const occupied = spawnSync(process.execPath, [...args, String(new URL(f.url).port)], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(occupied.status, 1); assert.match(occupied.stderr, /EADDRINUSE/); assert.equal(occupied.stderr.includes(f.token), false);
    assert.equal(fs.existsSync(path.join(f.core, 'data/jobs/v3')), false);
    const child = spawn(process.execPath, [...args, '0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise(resolve => child.once('close', resolve));
    t.after(async () => { child.kill(); await exited; });
    const ready = await new Promise((resolve, reject) => {
        let data = ''; const timer = setTimeout(() => reject(new Error('独立 HTTP 启动超时')), 10000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.stdout.on('data', bytes => { data += bytes; try { const value = JSON.parse(data); clearTimeout(timer); resolve(value); } catch {} });
    });
    const result = await fetch(ready.healthUrl, { headers: { Authorization: 'Bearer ' + f.token } });
    assert.equal(result.status, 200); assert.equal((await result.json()).result.mcp, false);
});

test('aborted request bodies do not submit work or poison subsequent HTTP requests', async t => {
    const f = await fixture(t);
    await new Promise(resolve => {
        const req = http.request(f.url + '/api/v4/submit', { method: 'POST', headers: { Authorization: 'Bearer ' + f.token, 'Content-Type': 'application/json', 'Content-Length': 500 } });
        req.on('error', () => {}); req.on('close', resolve);
        req.write('{"request":'); setTimeout(() => req.destroy(), 40);
    });
    assert.equal((await f.call('capabilities')).status, 200);
    assert.equal(fs.existsSync(path.join(f.core, 'data/jobs/v3')), false);
});
