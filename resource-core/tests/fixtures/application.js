const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync, spawn } = require('node:child_process');
const { copyTool } = require('../portable');
const { installType } = require('../helpers');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture(t, permissions = {}, count = 4, duration = 20) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-application-'));
    const tool = copyTool(root), core = path.join(tool, 'resource-core');
    installType(tool, 'fixture');
    const provider = path.join(core, 'providers/fixture'); fs.mkdirSync(provider);
    fs.writeFileSync(path.join(provider, 'index.js'), `const fs=require('node:fs');module.exports={apiVersion:2,version:'1.0.0',displayName:'隔离测试',adapters:{compress:{version:'1.0.0',resourceTypes:['fixture'],execute({input,output}){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,${duration});fs.writeFileSync(output,fs.readFileSync(input).subarray(0,8));return {output};}}}};`);
    const source = path.join(root, '素材'), output = path.join(root, '输出'), backup = path.join(root, '备份');
    fs.mkdirSync(source); fs.mkdirSync(backup);
    for (let i = 0; i < count; i++) fs.writeFileSync(path.join(source, i + '.pack'), 'PACK:' + 'test'.repeat(100));
    const policyFile = path.join(root, 'policy.json');
    fs.writeFileSync(policyFile, JSON.stringify({ schema: 'asset-toolbox.automation-policy/1', sourceRoots: [source], outputRoots: [output], backupRoots: [backup], ...permissions }));
    const { ApplicationService, respond } = require(path.join(core, 'application/service'));
    const service = new ApplicationService(policyFile);
    const request = { mode: 'process', folder: source, outputDir: output, pipeline: [{ id: 'compress-fixture', resourceType: 'fixture', operation: 'compress', provider: 'fixture', enabled: true, parameters: {}, providerOptions: {} }] };
    const call = (action, input) => respond(service, action, input);
    const until = async (id, predicate = state => state.done) => {
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) { const state = service.status(id); if (predicate(state)) return state; await delay(25); }
        throw new Error('作业等待超时');
    };
    t.after(async () => { await service.shutdown(); assert.equal(path.dirname(fs.realpathSync(root)), parent); assert.ok(path.basename(root).startsWith('asset-application-')); fs.rmSync(root, { recursive: true, force: true }); });
    return { root, tool, core, source, output, backup, policyFile, service, request, call, until, ApplicationService };
}

module.exports = { fixture };
