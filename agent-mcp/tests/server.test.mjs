import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const require = createRequire(import.meta.url);
const { copyTool } = require('../../resource-core/tests/portable');
const { installType } = require('../../resource-core/tests/helpers');
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(t) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-mcp-'));
    const tool = copyTool(root), core = path.join(tool, 'resource-core');
    installType(tool, 'fixture');
    const provider = path.join(core, 'providers/fixture'); fs.mkdirSync(provider);
    fs.writeFileSync(path.join(provider, 'index.js'), `const fs=require('node:fs');module.exports={apiVersion:2,version:'1.0.0',displayName:'MCP 测试',adapters:{compress:{version:'1.0.0',resourceTypes:['fixture'],execute({input,output}){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);fs.writeFileSync(output,fs.readFileSync(input).subarray(0,8));return {output};}}}};`);
    const serverRoot = path.join(tool, 'agent-mcp'); fs.mkdirSync(serverRoot);
    for (const file of ['server.mjs', 'tools.mjs']) fs.copyFileSync(path.join(packageRoot, file), path.join(serverRoot, file));
    fs.symlinkSync(path.join(packageRoot, 'node_modules'), path.join(serverRoot, 'node_modules'), 'junction');
    const source = path.join(root, '素材'), output = path.join(root, '输出'); fs.mkdirSync(source);
    for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(source, i + '.pack'), 'PACK:' + 'test'.repeat(100));
    const policy = path.join(root, 'policy.json');
    fs.writeFileSync(policy, JSON.stringify({ schema: 'asset-toolbox.automation-policy/1', sourceRoots: [source], outputRoots: [output], backupRoots: [] }));
    const clients = [];
    async function connect(mode = 'legacy') {
        const client = new Client({ name: 'asset-toolbox-integration', version: '1.0.0' }, { versionNegotiation: { mode } });
        const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(serverRoot, 'server.mjs'), '--policy', policy], stderr: 'pipe' });
        let stderr = ''; transport.stderr?.on('data', bytes => { stderr += bytes; });
        await client.connect(transport); clients.push(client);
        const call = async (action, args = {}) => {
            const result = await client.callTool({ name: 'asset_' + action, arguments: args });
            assert.ok(result.structuredContent, JSON.stringify(result) + stderr);
            assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
            return result.structuredContent;
        };
        return { client, call };
    }
    t.after(async () => {
        for (const client of clients) await client.close();
        // SDK 关闭可能先终止父进程；工作进程仍在当前文件结束后释放锁。
        for (let i = 0; i < 100; i++) {
            try { const unlock = require(path.join(core, 'application/lock')).acquire(); unlock(); break; } catch { await delay(30); }
        }
        assert.equal(path.dirname(fs.realpathSync(root)), parent); assert.ok(path.basename(root).startsWith('asset-mcp-'));
        fs.unlinkSync(path.join(serverRoot, 'node_modules'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const request = { mode: 'process', folder: source, outputDir: output, pipeline: [{ id: 'compress-fixture', resourceType: 'fixture', operation: 'compress', provider: 'fixture', enabled: true, parameters: {}, providerOptions: {} }] };
    return { ...(await connect()), connect, request, source, core };
}
async function until(call, jobId, predicate = state => state.done) {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) { const response = await call('status', { jobId }); assert.equal(response.ok, true); if (predicate(response.result)) return response.result; await delay(40); }
    throw new Error('MCP 作业等待超时');
}

test('official SDK discovers tools, validates input and runs idempotent jobs with structured paginated results', async t => {
    const f = await fixture(t);
    const { tools } = await f.client.listTools(); assert.equal(tools.length, 10);
    assert.ok(tools.find(tool => tool.name === 'asset_submit').inputSchema.properties.request);
    const catalog = await f.call('capabilities'); assert.equal(catalog.result.apiVersion, 3);
    const invalid = await f.client.callTool({ name: 'asset_submit', arguments: { request: f.request } }); assert.equal(invalid.isError, true);
    const denied = await f.call('validate', { request: { ...f.request, outputDir: path.dirname(f.source) } }); assert.equal(denied.error.code, 'PATH_FORBIDDEN');
    const started = await f.call('submit', { request: f.request, idempotencyKey: 'mcp-process' }); assert.equal(started.ok, true);
    const jobId = started.result.jobId;
    assert.equal((await f.call('submit', { request: f.request, idempotencyKey: 'mcp-process' })).result.replayed, true);
    const state = await until(f.call, jobId); assert.equal(state.exitCode, 0); assert.equal(state.task.completed, 8);
    const results = await f.call('results', { jobId, limit: 3 }); assert.equal(results.result.items.length, 3); assert.equal(results.result.nextOffset, 3);
    assert.equal((await f.call('tasks')).result.items[0].id, state.taskId);
    assert.equal(fs.readFileSync(path.join(f.source, '0.pack')).length, 405);
    await f.client.close();
    const reopened = await f.connect(); assert.equal((await reopened.call('status', { jobId })).result.done, true);
    assert.equal((await reopened.call('submit', { request: f.request, idempotencyKey: 'mcp-process' })).result.replayed, true);
});

test('disconnect safely cancels remaining files; another MCP session resumes the persistent task', async t => {
    const f = await fixture(t);
    const started = await f.call('submit', { request: f.request, idempotencyKey: 'disconnect' }); const jobId = started.result.jobId;
    await until(f.call, jobId, state => state.processed >= 1);
    await f.client.close();
    const reopened = await f.connect();
    const stopped = await until(reopened.call, jobId);
    assert.equal(stopped.cancelled, true); assert.ok(stopped.task.completed < 8);
    const resumed = await reopened.call('submit', { request: { mode: 'resume', taskId: stopped.taskId }, idempotencyKey: 'resume' });
    assert.equal((await until(reopened.call, resumed.result.jobId)).task.completed, 8);
});

test('stdio also negotiates the 2026-07-28 protocol with the official v2 client', async t => {
    const f = await fixture(t);
    await f.client.close();
    const modern = await f.connect({ pin: '2026-07-28' });
    assert.equal((await modern.client.listTools()).tools.length, 10);
    assert.equal((await modern.call('capabilities')).result.applicationApi, 'asset-toolbox.application/3');
});
