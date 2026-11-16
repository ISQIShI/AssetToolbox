const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const sharp = require('sharp');
const engine = require('../engine');
const { copyTool } = require('./portable');
function temporary(t) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-resize-'));
    t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)), parent); assert.ok(path.basename(root).startsWith('asset-resize-')); fs.rmSync(root, { recursive: true, force: true }); });
    return root;
}
const step = (parameters, resourceType = 'png', id = 'resize') => ({ id, resourceType, operation: 'image-resize', provider: 'sharp', enabled: true, parameters, providerOptions: {} });
async function image(filename, width = 4, height = 3) {
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < pixels.length; i += 4) { pixels[i] = i % 256; pixels[i + 1] = (i * 7) % 256; pixels[i + 2] = 40; pixels[i + 3] = i % 8 ? 255 : 64; }
    await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(filename);
    return fs.readFileSync(filename);
}
test('nearest-neighbour enlargement keeps alpha/pixels and accepts an output larger than its source', async t => {
    const root = temporary(t), source = path.join(root, '中文 素材'), output = path.join(root, '输出'); fs.mkdirSync(source);
    const filename = path.join(source, 'tile.png'), original = await image(filename);
    const pipeline = [step({ width: 80, height: 60, fit: 'fill', kernel: 'nearest', withoutEnlargement: false })];
    const records = [], summary = engine.processFolder(source, { pipeline, outputDir: output, log() {}, onFile: file => records.push(file) });
    assert.equal(summary.processed, 1); assert.equal(summary.failed, 0); assert.ok(summary.savedBytes < 0);
    const result = await sharp(path.join(output, 'tile.png')).raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([result.info.width, result.info.height, result.info.channels], [80, 60, 4]);
    const before = await sharp(filename).raw().toBuffer();
    for (const [x, y] of [[0, 0], [21, 22], [79, 59]]) {
        const originalIndex = (Math.floor(y / 20) * 4 + Math.floor(x / 20)) * 4, index = (y * 80 + x) * 4;
        assert.equal(result.data[index + 3], before[originalIndex + 3]);
        // libvips 预乘/还原半透明 RGB 时存在一个色阶的舍入，alpha 必须精确保持。
        for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(result.data[index + channel] - before[originalIndex + channel]) <= 1);
    }
    assert.deepEqual(fs.readFileSync(filename), original); assert.equal(records[0].steps[0].metadata.width, 80);
});
test('fit modes, no-enlargement and JPEG orientation have explicit output dimensions', async t => {
    const root = temporary(t), source = path.join(root, 'source'); fs.mkdirSync(source); await image(path.join(source, 'wide.png'), 40, 20);
    for (const [index, fit, width, height] of [[0, 'inside', 10, 5], [1, 'cover', 10, 10], [2, 'fill', 10, 10]]) {
        const output = path.join(root, 'out-' + index), result = engine.processFolder(source, { pipeline: [step({ width: 10, height: 10, fit })], outputDir: output, log() {} });
        assert.equal(result.failed, 0); const metadata = await sharp(path.join(output, 'wide.png')).metadata(); assert.deepEqual([metadata.width, metadata.height], [width, height]);
    }
    const output = path.join(root, 'no-enlarge'); engine.processFolder(source, { pipeline: [step({ width: 400, height: 200, withoutEnlargement: true })], outputDir: output, log() {} });
    assert.equal((await sharp(path.join(output, 'wide.png')).metadata()).width, 40);
    await sharp({ create: { width: 40, height: 20, channels: 3, background: '#cc3322' } }).jpeg().withMetadata({ orientation: 6 }).toFile(path.join(source, 'rotated.jpg'));
    assert.deepEqual(require('../properties/image/metadata').dimensions(fs.readFileSync(path.join(source, 'rotated.jpg')), 'jpg'), { width: 20, height: 40 });
    const jpegOut = path.join(root, 'jpeg'); engine.processFolder(source, { pipeline: [step({ width: 10, height: 10 }, 'jpg')], outputDir: jpegOut, log() {} });
    const jpeg = await sharp(path.join(jpegOut, 'rotated.jpg')).metadata(); assert.deepEqual([jpeg.width, jpeg.height], [5, 10]); assert.equal(jpeg.orientation, undefined);
});
test('ordered repeated operations and compression commit once, snapshot versions and restore exact originals', async t => {
    const root = temporary(t), tool = copyTool(root, true), core = path.join(tool, 'resource-core'), source = path.join(root, 'source'), backupDir = path.join(root, 'backup'); fs.mkdirSync(source);
    const original = await image(path.join(source, 'tile.png'), 40, 20);
    const pipeline = [step({ width: 30, height: 15 }, 'png', 'first'), step({ width: 10, height: 5 }, 'png', 'second'), { id: 'compress', resourceType: 'png', operation: 'compress', provider: 'pngquant', enabled: true }];
    const batch = require(path.join(core, 'batch'));
    const run = request => batch.runJob(request, fs.mkdtempSync(path.join(root, 'job-')), path.join(root, 'reports'));
    const result = run({ mode: 'process', folder: source, pipeline, backupDir });
    assert.equal(result.exitCode, 0, result.error); assert.equal(result.summary.backedUp, 1);
    const metadata = await sharp(path.join(source, 'tile.png')).metadata(); assert.deepEqual([metadata.width, metadata.height], [10, 5]);
    const tasks = require(path.join(core, 'tasks')), task = tasks.loadTask(result.task.taskFile);
    assert.equal(task.header.schema, 'asset-toolbox.task/2'); assert.equal(task.header.pipeline[0].versions.provider, '2.0.0');
    assert.equal([...task.entries.values()][0].record.steps.length, 3);
    require(path.join(core, 'framework/registry')).providers.get('sharp').adapters['image-resize'].version = '2.0.0';
    assert.match(run({ mode: 'resume', taskFile: task.taskFile }).error, /版本不匹配/);
    const preview = run({ mode: 'restore-preview', taskFile: task.taskFile }); assert.equal(preview.preview.recoverable, 1);
    const restored = run({ mode: 'restore', taskFile: task.taskFile, selection: preview.preview.files.map(({ path, backupHash, targetHash }) => ({ path, backupHash, targetHash })) });
    assert.equal(restored.summary.restored, 1); assert.deepEqual(fs.readFileSync(path.join(source, 'tile.png')), original);
});
test('a later step failure never commits an earlier resize or overwrites a conflicting output', async t => {
    const root = temporary(t), tool = copyTool(root, true), core = path.join(tool, 'resource-core'), source = path.join(root, 'source'); fs.mkdirSync(source);
    const original = await image(path.join(source, 'tile.png'), 40, 20);
    const providerDir = path.join(core, 'providers/failing'); fs.mkdirSync(providerDir);
    fs.writeFileSync(path.join(providerDir, 'index.js'), "module.exports={apiVersion:2,version:'1.0.0',displayName:'失败提供方',adapters:{'image-resize':{version:'1.0.0',resourceTypes:['png'],execute(){throw new Error('second step failed')}}}};");
    const engine = require(path.join(core, 'engine'));
    const pipeline = [step({ width: 20, height: 10 }), { ...step({ width: 10, height: 5 }, 'png', 'fail'), provider: 'failing' }];
    const backupDir = path.join(root, 'backup'), result = engine.processFolder(source, { pipeline, backupDir, log() {} });
    assert.equal(result.failed, 1); assert.equal(result.processed, 0); assert.equal(result.backedUp, 0);
    assert.deepEqual(fs.readFileSync(path.join(source, 'tile.png')), original); assert.equal(fs.existsSync(backupDir), false);
    const outputDir = path.join(root, 'output'); fs.mkdirSync(outputDir); fs.writeFileSync(path.join(outputDir, 'tile.png'), 'user file');
    assert.equal(engine.processFolder(source, { pipeline: [pipeline[0]], outputDir, log() {} }).failed, 1);
    assert.equal(fs.readFileSync(path.join(outputDir, 'tile.png'), 'utf8'), 'user file');
});

test('animation control chunks and damaged PNG data fail without losing originals', async t => {
    const root = temporary(t), source = path.join(root, 'source'); fs.mkdirSync(source);
    const filename = path.join(source, 'animated.png'), png = await image(filename);
    function chunk(type, data) {
        const payload = Buffer.concat([Buffer.from(type), data]), result = Buffer.alloc(data.length + 12);
        result.writeUInt32BE(data.length); payload.copy(result, 4);
        let crc = 0xffffffff;
        for (const byte of payload) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
        result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
    }
    const animation = Buffer.alloc(8); animation.writeUInt32BE(1);
    const control = Buffer.alloc(26); control.writeUInt32BE(4, 4); control.writeUInt32BE(3, 8); control.writeUInt16BE(1, 20); control.writeUInt16BE(10, 22);
    const animated = Buffer.concat([png.subarray(0, 33), chunk('acTL', animation), chunk('fcTL', control), png.subarray(33)]);
    fs.writeFileSync(filename, animated); const broken = png.subarray(0, 45); fs.writeFileSync(path.join(source, 'broken.png'), broken);
    const records = [], result = engine.processFolder(source, { pipeline: [step({ width: 2, height: 2 })], log() {}, onFile: record => records.push(record) });
    assert.equal(result.failed, 2); assert.equal(result.processed, 0);
    assert.match(records.find(record => record.path === 'animated.png').message, /不支持动画/);
    assert.equal(records[0].steps[0].status, 'failed');
    assert.deepEqual(fs.readFileSync(filename), animated); assert.deepEqual(fs.readFileSync(path.join(source, 'broken.png')), broken);
});
