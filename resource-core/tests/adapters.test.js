const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { copyTool } = require('./portable');
const { installType } = require('./helpers');

function fixture(t) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-adapters-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(root)), parent);
        assert.ok(path.basename(root).startsWith('asset-adapters-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const tool = copyTool(root), core = path.join(tool, 'resource-core');
    installType(tool, 'fixture');
    const operation = path.join(core, 'operations/append'); fs.mkdirSync(operation);
    fs.writeFileSync(path.join(operation, 'index.js'), `module.exports = {
        apiVersion: 1, version: '1.0.0', displayName: '测试追加', accepts: ['image'], resultPolicy: 'valid-output',
        schema: { defaults: { text: 'x' } }
    };`);
    const directory = path.join(core, 'providers/multi'); fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'index.js'), `const fs = require('node:fs'); module.exports = {
        apiVersion: 2, version: '1.0.0', displayName: '多操作测试工具',
        prepare() { fs.appendFileSync(__dirname + '/prepared.txt', 'once'); return 'prepared'; },
        adapters: {
            append: { version: '1.0.0', resourceTypes: ['fixture'],
                schema: { defaults: { suffix: '!' } },
                execute({ input, output, operation, resourceType, parameters, providerOptions, executable }) {
                    if (operation !== 'append' || resourceType !== 'fixture' || executable !== 'prepared') throw Error('分派错误');
                    fs.writeFileSync(output, fs.readFileSync(input) + parameters.text + providerOptions.suffix);
                    return { output, metadata: { operation } };
                }
            },
            compress: { version: '2.0.0', resourceTypes: ['fixture'],
                schema: { defaults: { size: 8, fail: false, grow: false }, limits: { size: { min: 5, max: 20 } } },
                execute({ input, output, operation, providerOptions, executable }) {
                    if (operation !== 'compress' || executable !== 'prepared') throw Error('分派错误');
                    if (providerOptions.fail) throw Error('后续操作失败');
                    const bytes = fs.readFileSync(input);
                    fs.writeFileSync(output, providerOptions.grow ? Buffer.concat([bytes, Buffer.from('larger')]) : bytes.subarray(0, providerOptions.size));
                    return { output, metadata: { operation, input: bytes.toString() } };
                }
            }
        }
    };`);
    const source = path.join(root, 'source'); fs.mkdirSync(source);
    const filename = path.join(source, 'fixture.pack'), original = 'PACK:original'; fs.writeFileSync(filename, original);
    const registry = require(path.join(core, 'framework/registry'));
    return { root, core, directory, source, filename, original, registry };
}
const step = (operation, providerOptions = {}, parameters = {}) => ({ id: operation, resourceType: 'fixture', operation, provider: 'multi', enabled: true, parameters, providerOptions });

test('one provider dispatches ordered operations, shares preparation and commits only the complete pipeline', t => {
    const { core, directory, source, filename, original } = fixture(t), records = [];
    const engine = require(path.join(core, 'engine'));
    const summary = engine.processFolder(source, { pipeline: [step('append', { suffix: '?' }, { text: 'added' }), step('compress')], log() {}, onFile: record => records.push(record) });
    assert.equal(summary.failed, 0); assert.equal(summary.processed, 1);
    assert.equal(fs.readFileSync(filename, 'utf8'), original.slice(0, 8));
    assert.equal(fs.readFileSync(path.join(directory, 'prepared.txt'), 'utf8'), 'once');
    assert.deepEqual(records[0].steps.map(s => s.metadata.operation), ['append', 'compress']);
    assert.equal(records[0].steps[1].metadata.input, original + 'added?');

    fs.writeFileSync(filename, original);
    const backupDir = path.join(source, 'backup');
    const failed = engine.processFolder(source, { pipeline: [step('append'), step('compress', { fail: true })], backupDir, log() {} });
    assert.equal(failed.failed, 1); assert.equal(failed.backedUp, 0);
    assert.equal(fs.readFileSync(filename, 'utf8'), original);
    assert.equal(fs.existsSync(backupDir), false);
    // 策略仍归操作所有：同一工具的追加可变大，压缩变大必须跳过。
    const skipped = [];
    engine.processFolder(source, { pipeline: [step('append'), step('compress', { grow: true })], log() {}, onFile: record => skipped.push(record) });
    assert.equal(fs.readFileSync(filename, 'utf8'), original + 'x!');
    assert.deepEqual(skipped[0].steps.map(s => s.status), ['processed', 'skipped']);
});

test('adapter fields, defaults and version snapshots stay isolated per operation', t => {
    const { registry } = fixture(t);
    const normalized = registry.normalizePipeline([step('append'), step('compress')]);
    assert.deepEqual(normalized.map(s => s.providerOptions), [{ suffix: '!' }, { size: 8, fail: false, grow: false }]);
    assert.deepEqual(normalized.map(s => s.versions.adapter), ['1.0.0', '2.0.0']);
    for (const value of [step('append', { size: 8 }), step('compress', { suffix: '!' }), step('compress', { size: 0 }), { ...step('append', { size: 8 }), enabled: false }]) {
        assert.throws(() => registry.normalizePipeline([value]));
    }
    const catalog = registry.describe(), provider = catalog.providers.find(p => p.id === 'multi');
    assert.equal(catalog.apiVersion, 4); assert.equal(Object.hasOwn(provider, 'fields'), false);
    assert.deepEqual(provider.adapters.map(a => [a.operation, a.fields.map(f => f.key)]), [['append', ['suffix']], ['compress', ['size', 'fail', 'grow']]]);
    const legacy = structuredClone(normalized[0]); delete legacy.versions.adapter;
    assert.throws(() => registry.normalizePipeline([legacy]), /版本不匹配/);
    registry.providers.get('multi').adapters.append.version = '1.1.0';
    assert.throws(() => registry.normalizePipeline([normalized[0]]), /版本不匹配/);
    assert.deepEqual(registry.normalizePipeline([normalized[1]])[0], normalized[1]);
});

test('registration rejects legacy providers and invalid or ambiguous adapter definitions', t => {
    const { core, registry } = fixture(t), file = path.join(core, 'providers/multi/index.js');
    const base = "apiVersion:2,version:'1.0.0',displayName:'invalid',";
    const variants = [
        "apiVersion:1,version:'1.0.0',displayName:'legacy',supports:[],execute(){}",
        base + "schema:{},adapters:{}",
        base + "adapters:{}",
        base + "adapters:{append:{version:'1.0.0',resourceTypes:['fixture']}}",
        base + "adapters:{append:{version:'bad',resourceTypes:['fixture'],execute(){}}}",
        base + "adapters:{append:{version:'1.0.0',resourceTypes:['fixture','fixture'],execute(){}}}",
        base + "adapters:{append:{version:'1.0.0',resourceTypes:['missing'],execute(){}}}",
        base + "adapters:{append:{version:'1.0.0',resourceTypes:['mp3'],execute(){}}}",
        base + "adapters:{unknown:{version:'1.0.0',resourceTypes:['fixture'],execute(){}}}",
        base + "adapters:{append:{version:'1.0.0',resourceTypes:['fixture'],execute(){},scheam:{}}}",
    ];
    for (const variant of variants) {
        fs.writeFileSync(file, 'module.exports={' + variant + '};'); delete require.cache[require.resolve(file)];
        assert.throws(() => registry.createRegistry(core), undefined, variant);
    }
});

test('settings v1 is explicitly refused without rewriting it', t => {
    const { root, core } = fixture(t), settings = require(path.join(core, 'settings'));
    const filename = path.join(root, 'settings.json'), legacy = { ...settings.defaultConfiguration(), schema: 'asset-toolbox.settings/1' };
    fs.writeFileSync(filename, JSON.stringify(legacy)); const bytes = fs.readFileSync(filename);
    assert.throws(() => settings.loadConfiguration(root), /不支持的设置契约/);
    assert.deepEqual(fs.readFileSync(filename), bytes);
});
