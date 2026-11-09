const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { copyTool } = require('./portable');
const registry = require('../framework/registry');
const settings = require('../settings');
const { compileSchema, normalizeParameters } = require('../framework/schema');
function temporary(t) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-contract-'));
    t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)), parent); assert.ok(path.basename(root).startsWith('asset-contract-')); fs.rmSync(root, { recursive: true, force: true }); });
    return root;
}
const resize = (id = 'resize') => ({ id, resourceType: 'png', operation: 'image-resize', provider: 'sharp', enabled: true, parameters: { width: 10, height: 20 }, providerOptions: {} });
test('independent type, operation and provider catalog allows same extension and isolated repeated parameters', () => {
    const steps = registry.normalizePipeline([resize('first'), { ...resize('second'), parameters: { width: 30, height: 40 } }, { id: 'compress', resourceType: 'png', operation: 'compress', provider: 'pngquant', enabled: true }]);
    assert.equal(steps[0].parameters.width, 10); assert.equal(steps[1].parameters.width, 30);
    assert.equal(steps[2].providerOptions.speed, 3); assert.equal(steps[2].parameters.speed, undefined);
    assert.deepEqual(steps[0].versions, { resourceType: '1.0.0', operation: '1.0.0', provider: '1.0.0' });
    assert.equal(registry.describe().providers.filter(p => p.supports.some(s => s.resourceType === 'png')).length, 2);
});
test('rejects mismatched combinations, stale versions, unknown fields and invalid disabled step parameters', () => {
    const invalid = [
        { ...resize(), resourceType: 'mp3' }, { ...resize(), operation: 'missing' }, { ...resize(), provider: 'lame' },
        { ...resize(), parameters: { width: 0 } }, { ...resize(), parameters: { width: 1.5 } },
        { ...resize(), parameters: { width: 16384, height: 16384 } }, { ...resize(), parameters: { fit: 'bad' } },
        { ...resize(), providerOptions: { jpegQuality: 101 } }, { ...resize(), parameters: { unknown: 3 } },
        { ...resize(), enabled: false, parameters: { width: '10' } }, { ...resize(), versions: { resourceType: '1.0.0', operation: '1.0.0', provider: '2.0.0' } },
        { ...resize(), unexpected: true }, { ...resize(), id: '../escape' },
        { ...resize(), parameters: null }, { ...resize(), providerOptions: false }, { ...resize(), versions: null },
    ];
    for (const value of invalid) assert.throws(() => registry.normalizePipeline([value]));
    assert.throws(() => registry.normalizePipeline([resize(), resize()]));
    assert.throws(() => registry.normalizePipeline(Array.from({ length: 65 }, (_, i) => resize('step-' + i))));
});
test('schema handles all field types and rejects unsafe names, ranges and precision', () => {
    const schema = compileSchema({ defaults: { level: 3, ratio: .5, flag: true, mode: 'fast', text: '中文' }, limits: { level: { min: 1, max: 9 }, ratio: { min: 0, max: 1 } }, parameters: {
        ratio: { type: 'number', decimalPlaces: 2 }, mode: { type: 'enum', choices: ['fast', 'slow'] }, text: { maxLength: 20 },
    } });
    assert.equal(normalizeParameters(schema, { text: '中文"引号' }).text, '中文"引号');
    for (const value of [{ ratio: .123 }, { mode: 'other' }, { level: Infinity }, { flag: 'true' }, { text: 'x'.repeat(21) }, { absent: 1 }]) assert.throws(() => normalizeParameters(schema, value));
    assert.throws(() => compileSchema({ defaults: { constructor: 1 } }));
    assert.throws(() => compileSchema({ defaults: { number: 1 } }));
});
test('discovers multiple providers for the same operation and excludes linked or disabled directories', t => {
    const root = temporary(t), core = path.join(copyTool(root), 'resource-core');
    const alternative = path.join(core, 'providers/alternative'); fs.mkdirSync(alternative);
    fs.writeFileSync(path.join(alternative, 'index.js'), "module.exports={apiVersion:1,version:'1.0.0',displayName:'替代实现',supports:[{resourceType:'png',operation:'compress'}],execute(){return {skipped:true}}};");
    const disabled = path.join(core, 'providers/_disabled'); fs.mkdirSync(disabled); fs.writeFileSync(path.join(disabled, 'index.js'), 'invalid javascript');
    const next = registry.createRegistry(core);
    assert.equal(next.providers.size, 5);
    assert.equal(next.normalizePipeline([{ ...resize(), operation: 'compress', provider: 'alternative', parameters: {} }])[0].provider, 'alternative');
    const collision = path.join(core, 'resource-types/collision'); fs.mkdirSync(collision);
    fs.writeFileSync(path.join(collision, 'index.js'), "module.exports={apiVersion:1,version:'1.0.0',displayName:'冲突',kind:'image',extensions:['.png'],validate(){return true}};");
    assert.throws(() => registry.createRegistry(core), /重复/);
});
test('settings use one atomic document and never interpret an old settings/task schema', t => {
    const root = temporary(t), before = settings.defaultConfiguration();
    assert.deepEqual(settings.loadConfiguration(root), before); assert.deepEqual(fs.readdirSync(root), []);
    const custom = { ...before, sourceDir: 'D:\\中文 素材', pipeline: [resize()] };
    const saved = settings.saveConfiguration(custom, root); assert.deepEqual(settings.loadConfiguration(root), saved);
    const filename = path.join(root, 'settings.json'), bytes = fs.readFileSync(filename);
    assert.throws(() => settings.saveConfiguration({ ...custom, version: 1 }, root));
    const rename = t.mock.method(fs, 'renameSync', () => { throw new Error('write blocked'); });
    assert.throws(() => settings.saveConfiguration({ ...custom, sourceDir: 'changed' }, root), /write blocked/); rename.mock.restore();
    assert.deepEqual(fs.readFileSync(filename), bytes); assert.deepEqual(fs.readdirSync(root), ['settings.json']);
    fs.writeFileSync(filename, JSON.stringify({ version: 1 })); assert.throws(() => settings.loadConfiguration(root), /契约/);
    const taskFile = path.join(root, 'task.json'); fs.writeFileSync(taskFile, JSON.stringify({ version: 1 }));
    assert.throws(() => require('../tasks').loadTask(taskFile), /版本不支持/);
});
