const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { fixture } = require('./fixtures/application');
const registry = require('../framework/registry');
const { matches } = require('../framework/filters');
const { dimensions } = require('../properties/image/metadata');
const filter = (...rules) => ({ schema: 'asset-toolbox.filter/1', any: [{ all: rules }] });
const rule = (property, operator, value) => ({ property, operator, value });
const png = (width, height) => { const data = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(data); data.writeUInt32BE(13, 8); data.write('IHDR', 12); data.writeUInt32BE(width, 16); data.writeUInt32BE(height, 20); return data; };
async function run(f, request, key = require('node:crypto').randomUUID()) {
    const job = f.service.submit(request, key), state = await f.until(job.jobId);
    assert.equal(state.exitCode, 0, JSON.stringify(state)); return { ...state, jobId: job.jobId };
}

test('property catalogs expose shared and type-specific definitions; filter bounds, types and versions fail closed', () => {
    const catalog = registry.describe();
    assert.ok(catalog.properties.find(item => item.id === 'file-size').resourceTypes.includes('mp3'));
    assert.deepEqual(catalog.properties.find(item => item.id === 'image-width').resourceTypes, ['jpg', 'png']);
    const expression = registry.normalizeFilter(filter(rule('file-size', 'gte', 100)));
    assert.equal(expression.any[0].all[0].version, '1.0.0');
    assert.equal(matches(expression, () => 100), true); assert.equal(matches(expression, () => 99), false);
    assert.equal(matches(registry.normalizeFilter(), () => { throw Error('空条件不得读取'); }), true);
    assert.equal(matches(registry.normalizeFilter(filter(rule('image-width', 'ne', 100))), () => undefined), false);
    for (const value of [null, { schema: 'asset-toolbox.filter/0', any: [] }, { schema: 'asset-toolbox.filter/1', any: [{ all: [] }] },
        filter(rule('missing', 'eq', 1)), filter(rule('file-size', 'contains', 1)), filter(rule('file-size', 'gt', '1')),
        filter(rule('file-size', 'gt', Infinity)), filter(rule('file-size', 'gt', NaN)), filter(rule('file-name', 'eq', 'x'.repeat(1025))),
        filter({ ...rule('file-size', 'eq', 1), version: '9.0.0' }), filter({ ...rule('file-size', 'eq', 1), script: 'evil' }),
        { schema: 'asset-toolbox.filter/1', any: Array.from({ length: 5 }, () => ({ all: Array.from({ length: 16 }, () => rule('file-size', 'eq', 1)) })) }]) assert.throws(() => registry.normalizeFilter(value));
    assert.throws(() => registry.normalizeFilter(filter(rule('image-width', 'gt', 1)), 'mp3'));
    const any = registry.normalizeFilter({ schema: 'asset-toolbox.filter/1', any: [{ all: [rule('resource-type', 'eq', 'png')] }, { all: [rule('file-size', 'gt', 20)] }] });
    assert.equal(matches(any, id => id === 'resource-type' ? 'png' : 0), true);
});

test('image properties read PNG and JPEG EXIF dimensions and reject incomplete or oversized headers', () => {
    assert.deepEqual(dimensions(png(200, 100), 'png'), { width: 200, height: 100 });
    const exif = Buffer.from('45786966000049492a0008000000010012010300010000000600000000000000', 'hex');
    const segment = Buffer.alloc(exif.length + 4); segment.writeUInt16BE(0xffe1); segment.writeUInt16BE(exif.length + 2, 2); exif.copy(segment, 4);
    const jpeg = Buffer.concat([Buffer.from('ffd8', 'hex'), segment, Buffer.from('ffc0000b08006400c801011100ffda', 'hex')]);
    assert.deepEqual(dimensions(jpeg, 'jpg'), { width: 100, height: 200 });
    // XMP 同样使用 APP1，但不能覆盖前一个 EXIF 方向。
    const xmp = Buffer.from('ffe1000661626364', 'hex');
    assert.deepEqual(dimensions(Buffer.concat([jpeg.subarray(0, 2 + segment.length), xmp, jpeg.subarray(2 + segment.length)]), 'jpg'), { width: 100, height: 200 });
    for (const bytes of [Buffer.alloc(0), png(0, 100), png(10, 10).subarray(0, 20)]) assert.throws(() => dimensions(bytes, 'png'));
    for (const bytes of [jpeg.subarray(0, 12), Buffer.from('ffd8ffe1ffff00', 'hex'), jpeg.subarray(0, -2)]) assert.throws(() => dimensions(bytes, 'jpg'));
});

test('property readers are lazy and cached, and common values use the current step buffer', () => {
    const get = registry.propertyCatalog.context({ filename: 'photo.jpg', relativePath: '素材/photo.jpg', resourceType: registry.resourceTypes.get('jpg'), buffer: Buffer.from('bad'), stat: { size: 99 } });
    assert.equal(get('file-size'), 3); assert.equal(get('extension'), '.jpg');
    assert.throws(() => get('image-width'), /JPEG/);
    const image = registry.propertyCatalog.context({ filename: 'x.png', relativePath: 'x.png', resourceType: registry.resourceTypes.get('png'), buffer: png(10, 5), stat: {} });
    assert.equal(image('image-width'), 10); assert.equal(image('image-height'), 5); assert.equal(image('image-pixels'), 50); assert.equal(image('image-aspect-ratio'), 2);
});

test('source exclusion controls preview and fixed task plans without copying or backing up excluded files', async t => {
    const f = fixture(t, { allowOverwrite: true, allowRestore: true }, 3);
    const sourceFilter = filter(rule('file-name', 'eq', '1.pack'));
    const preview = await run(f, { ...f.request, mode: 'preview', sourceFilter });
    assert.equal(preview.preview.total, 1); assert.equal(preview.preview.discovered, 3); assert.equal(preview.preview.filteredOut, 2);
    assert.equal(fs.existsSync(f.output), false);
    const completed = await run(f, { ...f.request, sourceFilter });
    assert.deepEqual(fs.readdirSync(f.output), ['1.pack']);
    const task = require(path.join(f.core, 'tasks')).loadTask(f.service.taskFile(completed.taskId));
    assert.deepEqual([...task.entries.keys()], ['1.pack']); assert.equal(task.header.sourceFilter.any[0].all[0].version, '1.0.0');
    assert.equal(completed.summary.filteredOut, 2);
    const { outputDir, ...request } = f.request;
    const overwritten = await run(f, { ...request, backupDir: f.backup, sourceFilter });
    assert.deepEqual(fs.readdirSync(overwritten.task.backupSession), ['1.pack']);
    const restore = await run(f, { mode: 'restore-preview', taskId: overwritten.taskId });
    const selection = f.service.results(restore.jobId, 'restore', {}).items.map(({ path, backupHash, targetHash }) => ({ path, backupHash, targetHash }));
    assert.equal(selection.length, 1);
    // 恢复 worker 不加载属性/转换插件；破坏这些定义后仍可按备份与哈希恢复。
    fs.writeFileSync(path.join(f.core, 'properties/image/index.js'), 'throw Error("不可加载属性插件")');
    const restored = await run(f, { mode: 'restore', taskId: overwritten.taskId, selection });
    assert.equal(restored.summary.restored, 1);
    for (const name of ['0.pack', '1.pack', '2.pack']) assert.equal(fs.readFileSync(path.join(f.source, name), 'utf8'), 'PACK:' + 'test'.repeat(100));
});

test('resume keeps the original filtered list and never includes newly matching files', async t => {
    const f = fixture(t, {}, 8, 100), sourceFilter = filter(rule('file-name', 'ne', '7.pack'));
    const job = f.service.submit({ ...f.request, sourceFilter }, 'cancel-filtered');
    await f.until(job.jobId, state => state.processed >= 1); f.service.dispatch('cancel', { jobId: job.jobId });
    const stopped = await f.until(job.jobId); assert.equal(stopped.cancelled, true);
    fs.writeFileSync(path.join(f.source, 'new.pack'), 'PACK:' + 'new'.repeat(100));
    const resumed = await run(f, { mode: 'resume', taskId: stopped.taskId });
    assert.equal(resumed.task.total, 7); assert.equal(resumed.task.completed, 7);
    assert.equal(resumed.summary.discovered, 8); assert.equal(resumed.summary.filteredOut, 1);
    assert.equal(fs.existsSync(path.join(f.output, 'new.pack')), false); assert.equal(fs.existsSync(path.join(f.output, '7.pack')), false);
});

test('empty source selection and filtered overwrite steps create no material outputs or backups', async t => {
    const f = fixture(t, { allowOverwrite: true }, 2);
    const empty = await run(f, { ...f.request, sourceFilter: filter(rule('file-size', 'gt', 10000)) });
    assert.equal(empty.summary.total, 0); assert.equal(empty.summary.filteredOut, 2);
    assert.equal(fs.existsSync(f.output), false);
    const { outputDir, ...request } = f.request;
    const skipped = await run(f, { ...request, backupDir: f.backup, pipeline: request.pipeline.map(step => ({ ...step, filter: filter(rule('file-size', 'gt', 10000)) })) });
    assert.equal(skipped.summary.processed, 0); assert.equal(skipped.summary.skipped, 2); assert.equal(skipped.summary.backedUp, 0);
    assert.equal(fs.existsSync(skipped.task.backupSession), false);
    for (const name of ['0.pack', '1.pack']) assert.equal(fs.readFileSync(path.join(f.source, name), 'utf8'), 'PACK:' + 'test'.repeat(100));
});

test('changed property versions reject resume before writing any remaining materials', async t => {
    const f = fixture(t, {}, 8, 100);
    const job = f.service.submit({ ...f.request, sourceFilter: filter(rule('file-size', 'gt', 0)) }, 'version-filter');
    await f.until(job.jobId, state => state.processed >= 1); f.service.dispatch('cancel', { jobId: job.jobId });
    const stopped = await f.until(job.jobId), before = fs.readdirSync(f.output);
    const moduleFile = path.join(f.core, 'properties/file/index.js');
    fs.writeFileSync(moduleFile, fs.readFileSync(moduleFile, 'utf8').replace("version: '1.0.0'", "version: '2.0.0'"));
    const resumed = f.service.submit({ mode: 'resume', taskId: stopped.taskId }, 'new-property-version');
    const state = await f.until(resumed.jobId);
    assert.equal(state.exitCode, 1); assert.match(state.error, /属性实现版本不匹配/);
    assert.deepEqual(fs.readdirSync(f.output), before);
});

test('step filters inspect preceding outputs and skipped steps do not invoke the adapter', async t => {
    const f = fixture(t, {}, 0);
    fs.writeFileSync(path.join(f.source, 'image.png'), png(200, 100));
    fs.writeFileSync(path.join(f.core, 'providers/fixture/index.js'), `const fs=require('node:fs');module.exports={apiVersion:2,version:'1.0.0',displayName:'图片夹具',adapters:{'image-resize':{version:'1.0.0',resourceTypes:['png'],execute({input,output,parameters}){const bytes=fs.readFileSync(input);bytes.writeUInt32BE(parameters.width,16);bytes.writeUInt32BE(parameters.height,20);fs.writeFileSync(output,bytes);return {output};}}}};`);
    const step = (id, width, condition) => ({ id, resourceType: 'png', operation: 'image-resize', provider: 'fixture', enabled: true, parameters: { width, height: 20 }, filter: condition });
    const completed = await run(f, { ...f.request, pipeline: [step('first', 40), step('second', 10, filter(rule('image-width', 'gt', 100)))] });
    assert.equal(dimensions(fs.readFileSync(path.join(f.output, 'image.png')), 'png').width, 40);
    const file = f.service.results(completed.jobId, 'files', {}).items[0];
    assert.deepEqual(file.steps.map(step => step.status), ['processed', 'filtered']);
    assert.equal(dimensions(fs.readFileSync(path.join(f.source, 'image.png')), 'png').width, 200);
});

test('source metadata errors fail before material writes and rejected properties cannot be submitted', async t => {
    const f = fixture(t, {}, 0);
    fs.writeFileSync(path.join(f.source, 'broken.jpg'), 'broken');
    const request = { ...f.request, pipeline: [], sourceFilter: filter(rule('image-width', 'gt', 1)) };
    const job = f.service.submit(request, 'bad-metadata'), state = await f.until(job.jobId);
    assert.equal(state.exitCode, 1); assert.match(state.error, /来源属性读取失败/); assert.equal(fs.existsSync(f.output), false);
    assert.equal(fs.existsSync(path.join(f.core, 'data/tasks')), false);
    const bad = await f.call('validate', { request: { ...request, sourceFilter: filter(rule('unknown', 'eq', 1)) } });
    assert.equal(bad.ok, false); assert.equal(bad.error.code, 'INVALID_REQUEST');
});

test('shortcut CLI accepts the same source filter and old persisted settings/tasks are rejected', t => {
    const f = fixture(t, {}, 2), filterFile = path.join(f.root, 'filter.json'), pipelineFile = path.join(f.root, 'pipeline.json');
    fs.writeFileSync(filterFile, JSON.stringify(filter(rule('file-name', 'eq', '0.pack')))); fs.writeFileSync(pipelineFile, JSON.stringify(f.request.pipeline));
    const result = spawnSync(process.execPath, [path.join(f.core, 'cli.js'), f.source, '--pipeline', pipelineFile, '--source-filter', filterFile, '--output', f.output], { windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr + result.stdout); assert.deepEqual(fs.readdirSync(f.output), ['0.pack']);
    const settings = require(path.join(f.core, 'settings'));
    assert.throws(() => settings.validateConfiguration({ ...settings.defaultConfiguration(), schema: 'asset-toolbox.settings/2' }));
    const taskId = JSON.parse(result.stdout).result.state.taskId, filename = f.service.taskFile(taskId);
    const header = JSON.parse(fs.readFileSync(filename)); header.schema = 'asset-toolbox.task/1'; fs.writeFileSync(filename, JSON.stringify(header));
    assert.throws(() => require(path.join(f.core, 'tasks')).loadTask(filename), /版本/);
});
