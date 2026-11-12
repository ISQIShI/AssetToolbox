import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const require = createRequire(import.meta.url);
const { copyTool } = require('../../resource-core/tests/portable');
const { installType } = require('../../resource-core/tests/helpers');
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-mcp-http-'));
    const tool = copyTool(root), core = path.join(tool, 'resource-core'), serverRoot = path.join(tool, 'agent-mcp');
    fs.mkdirSync(serverRoot);
    for (const file of ['server.mjs', 'tools.mjs']) fs.copyFileSync(path.join(packageRoot, file), path.join(serverRoot, file));
    fs.symlinkSync(path.join(packageRoot, 'node_modules'), path.join(serverRoot, 'node_modules'), 'junction');
    installType(tool, 'fixture');
    const provider = path.join(core, 'providers/fixture'); fs.mkdirSync(provider);
    fs.writeFileSync(path.join(provider, 'index.js'), `const fs=require('node:fs');module.exports={apiVersion:2,version:'1.0.0',displayName:'HTTP MCP 测试',adapters:{compress:{version:'1.0.0',resourceTypes:['fixture'],execute({input,output}){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,120);fs.writeFileSync(output,fs.readFileSync(input).subarray(0,8));return {output};}}}};`);
    const source = path.join(root, '素材'), output = path.join(root, '输出'); fs.mkdirSync(source);
    for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(source, i + '.pack'), 'PACK:' + 'data'.repeat(100));
    const policy = path.join(root, 'policy.json'), tokenFile = path.join(root, 'token.txt'), token = randomBytes(32).toString('base64url');
    fs.writeFileSync(policy, JSON.stringify({ schema: 'asset-toolbox.automation-policy/1', sourceRoots: [source], outputRoots: [output], backupRoots: [] }));
    fs.writeFileSync(tokenFile, token);
    const child = spawn(process.execPath, [path.join(serverRoot, 'server.mjs'), '--transport', 'http', '--policy', policy, '--token-file', tokenFile, '--port', '0'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise(resolve => child.once('close', resolve));
    let stderr = '', stdout = ''; child.stdout.on('data', chunk => { stdout += chunk; });
    const clients = [], cleanups = [];
    t.after(async () => {
        for (const cleanup of cleanups) await cleanup();
        for (const client of clients) await client.close();
        child.kill(); await exited;
        for (let i = 0; i < 100; i++) { try { const release = require(path.join(core, 'application/lock')).acquire(); release(); break; } catch { await delay(30); } }
        assert.equal(stderr.includes(token), false); assert.equal(stdout.includes(token), false);
        fs.unlinkSync(path.join(serverRoot, 'node_modules'));
        assert.equal(path.dirname(fs.realpathSync(root)), parent); assert.ok(path.basename(root).startsWith('asset-mcp-http-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const ready = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('HTTP 服务启动超时：' + stderr)), 15000);
        child.once('error', error => { clearTimeout(timeout); reject(error); });
        child.once('close', () => { clearTimeout(timeout); reject(new Error(stderr)); });
        child.stderr.on('data', chunk => {
            stderr += chunk;
            for (const line of stderr.split('\n')) { try { const value = JSON.parse(line); if (value.mcpUrl) { clearTimeout(timeout); resolve(value); } } catch {} }
        });
    });
    async function connect(mode = 'legacy') {
        const client = new Client({ name: 'asset-http-integration', version: '1.0.0' }, { versionNegotiation: { mode } });
        clients.push(client);
        await client.connect(new StreamableHTTPClientTransport(new URL(ready.mcpUrl), { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
        const call = async (action, args = {}) => {
            const response = await client.callTool({ name: 'asset_' + action, arguments: args });
            assert.ok(response.structuredContent, JSON.stringify(response));
            assert.deepEqual(JSON.parse(response.content[0].text), response.structuredContent);
            return response.structuredContent;
        };
        return { client, call };
    }
    const api = async (action, input = {}) => {
        const response = await fetch(ready.apiUrl + action, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
        return { status: response.status, body: await response.json() };
    };
    const request = { mode: 'process', folder: source, outputDir: output, pipeline: [{ id: 'compress', resourceType: 'fixture', operation: 'compress', provider: 'fixture', enabled: true }] };
    return { ...ready, token, connect, api, request, source, output, core, root, tool, policy, serverRoot, cleanups };
}
async function until(call, jobId, predicate = state => state.done) {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) { const response = await call('status', { jobId }); assert.equal(response.ok, true); if (predicate(response.result)) return response.result; await delay(35); }
    throw new Error('HTTP MCP 作业等待超时');
}

test('Streamable HTTP supports both protocol eras and concurrent clients without sharing MCP request state', async t => {
    const f = await fixture(t);
    const [legacy, modern] = await Promise.all([f.connect(), f.connect({ pin: '2026-07-28' })]);
    const lists = await Promise.all([legacy.client.listTools(), modern.client.listTools()]);
    assert.equal(lists[0].tools.length, 10);
    assert.deepEqual(lists[0].tools.map(tool => [tool.name, tool.inputSchema]), lists[1].tools.map(tool => [tool.name, tool.inputSchema]));
    const stream = await fetch(f.mcpUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + f.token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'tools/list' }) });
    assert.equal(stream.status, 200); assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    assert.match(await stream.text(), /"id":42/);
    const [capabilities, jobs] = await Promise.all([legacy.call('capabilities'), modern.call('jobs')]);
    assert.equal(capabilities.result.apiVersion, 3); assert.equal(jobs.result.total, 0);
    const submitted = await modern.call('submit', { request: f.request, idempotencyKey: 'shared-http' }); const { jobId } = submitted.result;
    assert.equal((await f.api('submit', { request: f.request, idempotencyKey: 'shared-http' })).body.result.replayed, true);
    assert.equal((await legacy.call('submit', { request: f.request, idempotencyKey: 'shared-http' })).result.jobId, jobId);
    await until(legacy.call, jobId, state => state.processed >= 1);
    await modern.client.close(); await legacy.client.close();
    // HTTP transport.close 只关闭网络，不取消已提交的应用作业。
    const reopened = await f.connect();
    const state = await until(reopened.call, jobId); assert.equal(state.exitCode, 0); assert.equal(state.task.completed, 8); assert.equal(Boolean(state.cancelled), false);
    const results = await f.api('results', { jobId, limit: 2 }); assert.equal(results.body.result.items.length, 2); assert.equal(results.body.result.nextOffset, 2);
    assert.equal(fs.readFileSync(path.join(f.source, '0.pack'), 'utf8'), 'PACK:' + 'data'.repeat(100));
    assert.equal(fs.readFileSync(path.join(f.output, '0.pack'), 'utf8'), 'PACK:dat');
});

test('MCP HTTP shares authentication and bounds; cancellation is explicit and resumes through the HTTP API', async t => {
    const f = await fixture(t);
    assert.equal((await fetch(f.mcpUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(f.mcpUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + f.token, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    const oversized = await fetch(f.mcpUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + f.token, 'Content-Type': 'application/json' }, body: 'x'.repeat(1024 * 1024 + 1) }); assert.equal(oversized.status, 413);
    const chunkedStatus = await new Promise((resolve, reject) => {
        const request = http.request(f.mcpUrl, { method: 'POST', headers: { Authorization: 'Bearer ' + f.token, 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
        request.on('error', reject); request.write('"'); request.write('x'.repeat(1024 * 1024)); request.end('"');
    });
    assert.equal(chunkedStatus, 413);
    const client = await f.connect();
    const submitted = await client.call('submit', { request: f.request, idempotencyKey: 'cancel-http' }); const { jobId } = submitted.result;
    await until(client.call, jobId, state => state.processed >= 1);
    assert.equal((await f.api('cancel', { jobId })).status, 200);
    const stopped = await until(client.call, jobId); assert.equal(stopped.cancelled, true); assert.ok(stopped.task.completed < 8);
    const resumed = await f.api('submit', { request: { mode: 'resume', taskId: stopped.taskId }, idempotencyKey: 'http-resume' });
    assert.equal((await until(client.call, resumed.body.result.jobId)).task.completed, 8);
    const invalid = await client.call('validate', { request: { ...f.request, folder: path.dirname(f.source) } }); assert.equal(invalid.error.code, 'PATH_FORBIDDEN');
});

test('desktop, CLI, stdio MCP, HTTP and HTTP MCP share schemas, durable jobs, cancellation and results', async t => {
    const f = await fixture(t), remote = await f.connect();
    const stdio = new Client({ name: 'cross-entry', version: '1.0.0' });
    f.cleanups.push(() => stdio.close());
    await stdio.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(f.serverRoot, 'server.mjs'), '--policy', f.policy], stderr: 'pipe' }));
    const bridge = spawn(process.execPath, [path.join(f.core, 'desktop-bridge.js')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let sequence = 0, stderr = ''; const pending = new Map();
    bridge.stderr.on('data', chunk => { stderr += chunk; });
    const closed = new Promise(resolve => bridge.once('close', resolve));
    f.cleanups.push(async () => { bridge.stdin.end(); await closed; });
    createInterface({ input: bridge.stdout }).on('line', line => { const { id, ...response } = JSON.parse(line); pending.get(id)?.(response); pending.delete(id); });
    const desktop = (action, payload = {}) => new Promise(resolve => { const id = ++sequence; pending.set(id, resolve); bridge.stdin.write(JSON.stringify({ id, action, payload }) + '\n'); });
    const cli = async (action, input = {}) => {
        const result = spawnSync(process.execPath, [path.join(f.core, 'cli.js'), 'api', action, '--policy', f.policy, '--input', '-'], { input: JSON.stringify(input), encoding: 'utf8', windowsHide: true, timeout: 20000 });
        assert.ifError(result.error); return JSON.parse(result.stdout);
    };
    const calls = [desktop, cli, async (action, input = {}) => (await stdio.callTool({ name: 'asset_' + action, arguments: input })).structuredContent, async (action, input) => (await f.api(action, input)).body, remote.call];
    const catalogs = await Promise.all(calls.map(call => call('capabilities')));
    for (const response of catalogs) { assert.equal(response.schema, 'asset-toolbox.response/4'); assert.deepEqual(response.result.inputSchemas, catalogs[0].result.inputSchemas); }
    for (const call of calls.slice(1)) {
        assert.equal((await call('storage-preview')).error.code, 'PERMISSION_DENIED');
        assert.equal((await call('storage-clean', { retentionDays: 30, selection: [{ jobId: 'a'.repeat(64), fingerprint: 'b'.repeat(64) }] })).error.code, 'PERMISSION_DENIED');
    }
    const invalid = { ...f.request, pipeline: [{ ...f.request.pipeline[0], operation: 'unknown-operation' }] };
    const errors = await Promise.all(calls.map(call => call('validate', { request: invalid })));
    for (const response of errors) { assert.equal(response.ok, false); assert.deepEqual(response.error, errors[0].error); }
    for (const call of calls) assert.equal((await call('validate', { request: f.request })).ok, true);

    // 桌面创建，外部连接查询/取消；同一 jobId 在所有入口可见。
    const submitted = await desktop('submit', { request: f.request, idempotencyKey: 'desktop-owned' });
    assert.equal(submitted.ok, true, stderr + JSON.stringify(submitted)); const { jobId } = submitted.result;
    assert.equal((await desktop('submit', { request: f.request, idempotencyKey: 'desktop-owned' })).result.replayed, true);
    await until(remote.call, jobId, state => state.processed >= 1);
    await f.api('cancel', { jobId });
    const cancelled = await until(remote.call, jobId); assert.equal(cancelled.cancelled, true); assert.ok(cancelled.task.completed < 8);
    const states = await Promise.all(calls.map(call => call('status', { jobId })));
    for (const response of states) assert.deepEqual(response.result, states[0].result);
    assert.equal('taskFile' in states[0].result.task, false); assert.equal('reportDirectory' in states[0].result, false);
    const resumed = await cli('submit', { request: { mode: 'resume', taskId: cancelled.taskId }, idempotencyKey: 'cli-resume' });
    assert.equal(resumed.result.state.task.completed, 8);
    const pages = await Promise.all(calls.map(call => call('results', { jobId: resumed.result.jobId, limit: 2 })));
    for (const response of pages) assert.deepEqual(response, pages[0]);
    for (const call of calls) {
        assert.ok((await call('jobs')).result.items.some(item => item.jobId === jobId));
        assert.ok((await call('tasks')).result.items.some(item => item.id === cancelled.taskId));
    }
    // 外部提交由桌面读取；HTTP 客户端断开不结束作业。
    const preview = await remote.call('submit', { request: { ...f.request, mode: 'preview' }, idempotencyKey: 'http-preview' });
    await remote.client.close(); assert.equal((await until(desktop, preview.result.jobId)).exitCode, 0);
    const replay = await cli('submit', { request: { ...f.request, mode: 'preview' }, idempotencyKey: 'http-preview' });
    assert.equal(replay.result.replayed, true); assert.equal(replay.result.jobId, preview.result.jobId);
    assert.equal(fs.readFileSync(path.join(f.source, '0.pack'), 'utf8'), 'PACK:' + 'data'.repeat(100));
    assert.equal(fs.existsSync(path.join(f.core, 'data/settings.json')), false);
});
