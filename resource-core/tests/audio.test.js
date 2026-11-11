const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { processFolder } = require('../engine');
const { normalizePipeline, providers, createRegistry } = require('../framework/registry');
const { inspect, run } = require('../providers/ffmpeg/audio');
const { copyTool } = require('./portable');
const executable = path.resolve(__dirname, '../providers/ffmpeg/ffmpeg.exe');
const step = (operation, parameters = {}, resourceType = 'wav', id = operation) => ({ id, operation, resourceType, provider: 'ffmpeg', enabled: true, parameters });
function fixture(t) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-audio-')), source = path.join(root, '素材'); fs.mkdirSync(source);
    t.after(() => { assert.equal(path.dirname(fs.realpathSync(root)), parent); assert.ok(path.basename(root).startsWith('asset-audio-')); fs.rmSync(root, { recursive: true, force: true }); });
    return { root, source, outputDir: path.join(root, '结果') };
}
function wav(filename, { seconds = 2, amplitude = 0.1, channels = 1, impulse = false } = {}) {
    const rate = 48000, frames = Math.round(seconds * rate), bytes = Buffer.alloc(44 + frames * channels * 2);
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28);
    bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
    for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) bytes.writeInt16LE(Math.round((impulse && i === 4800 ? 0.95 : Math.sin(i * 2 * Math.PI * 440 / rate) * amplitude) * 32767 * (c ? -0.5 : 1)), 44 + (i * channels + c) * 2);
    fs.writeFileSync(filename, bytes); return bytes;
}
const process = (source, options) => {
    const records = [], summary = processFolder(source, { log() {}, ...options, onFile: file => records.push(file) });
    return { records, summary };
};
function samples(filename) {
    const result = spawnSync(executable, ['-v', 'error', '-i', filename, '-f', 'f64le', '-c:a', 'pcm_f64le', '-'], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr?.toString());
    return Array.from({ length: result.stdout.length / 8 }, (_, index) => result.stdout.readDoubleLE(index * 8));
}

test('analysis returns finite measurements without copying, modifying or backing up any source', t => {
    const { source, outputDir } = fixture(t), filename = path.join(source, '声音.wav'), original = wav(filename);
    const before = fs.statSync(filename); let intents = 0;
    const { records, summary } = process(source, { pipeline: [step('audio-analyze')], outputDir, beforeCommit() { intents++; } });
    assert.equal(summary.failed, 0); assert.equal(summary.processed, 0); assert.equal(summary.copied, 0); assert.equal(intents, 0);
    assert.equal(fs.existsSync(outputDir), false); assert.deepEqual(fs.readFileSync(filename), original); assert.equal(fs.statSync(filename).mtimeMs, before.mtimeMs);
    const audio = records[0].steps[0].metadata.audio;
    assert.equal(records[0].steps[0].status, 'analyzed'); assert.equal(audio.before.channels, 1); assert.equal(audio.before.sampleRate, 48000);
    assert.ok(Number.isFinite(audio.before.integratedLufs)); assert.ok(audio.before.truePeakDb < -19);
    assert.equal(records[0].readOnly, true);
});

test('gain uses one constant multiplier for both channels and normalization reaches a feasible target', t => {
    const { source, outputDir } = fixture(t), filename = path.join(source, 'stereo.wav'), original = wav(filename, { channels: 2 });
    const result = process(source, { pipeline: [step('audio-gain', { gainDb: 6 })], outputDir });
    assert.equal(result.summary.failed, 0, JSON.stringify(result.records));
    const before = samples(filename), after = samples(path.join(outputDir, 'stereo.wav')), ratio = 10 ** (6 / 20);
    assert.equal(after.length, before.length);
    for (let i = 111; i < 1000; i += 17) assert.ok(Math.abs(after[i] - before[i] * ratio) < 0.00004);
    assert.deepEqual(fs.readFileSync(filename), original);
    const normalized = process(source, { pipeline: [step('audio-normalize', { targetLufs: -18 })], outputDir: outputDir + '-normalized' });
    assert.equal(normalized.summary.failed, 0, JSON.stringify(normalized.records));
    const audio = normalized.records[0].steps[0].metadata.audio;
    assert.ok(Math.abs(audio.after.integratedLufs + 18) <= 0.3); assert.equal(audio.targetReached, true);
});

test('peak protection reduces uniform gain or rejects without silently compressing dynamics', t => {
    const { source, outputDir } = fixture(t), filename = path.join(source, 'peaky.wav'), original = wav(filename, { amplitude: 0.02, impulse: true });
    const limited = process(source, { pipeline: [step('audio-normalize', { targetLufs: -10, truePeakDb: -3 })], outputDir });
    assert.equal(limited.summary.failed, 0, JSON.stringify(limited.records));
    const audio = limited.records[0].steps[0].metadata.audio;
    assert.equal(audio.limited, true); assert.equal(audio.targetReached, false); assert.ok(audio.after.truePeakDb <= -3);
    const before = samples(filename), after = samples(path.join(outputDir, 'peaky.wav')), ratio = 10 ** (audio.appliedGainDb / 20);
    for (const i of [4800, 121, 523]) assert.ok(Math.abs(after[i] - before[i] * ratio) < 0.0001);
    const rejected = process(source, { pipeline: [step('audio-gain', { gainDb: 20, peakPolicy: 'reject' })], outputDir: outputDir + '-reject' });
    assert.equal(rejected.summary.failed, 1); assert.match(rejected.records[0].message, /真峰值/);
    assert.deepEqual(fs.readFileSync(filename), original); assert.deepEqual(fs.readFileSync(path.join(outputDir + '-reject', 'peaky.wav')), original);
});

test('silence and short audio do not trigger uncontrolled normalization; corrupt inputs fail safely', t => {
    const { source, outputDir } = fixture(t);
    const silent = wav(path.join(source, 'silent.wav'), { amplitude: 0 }), short = wav(path.join(source, 'short.wav'), { seconds: 0.1 });
    fs.writeFileSync(path.join(source, 'broken.wav'), Buffer.from('RIFF0000WAVEbroken'));
    const { records, summary } = process(source, { pipeline: [step('audio-normalize')], outputDir });
    assert.equal(summary.failed, 1); assert.equal(summary.processed, 0);
    for (const name of ['silent.wav', 'short.wav']) {
        const audio = records.find(row => row.path === name).steps[0].metadata.audio;
        assert.equal(audio.before.integratedLufs, null); assert.match(audio.warnings.join(' '), /无法可靠/);
    }
    assert.deepEqual(fs.readFileSync(path.join(outputDir, 'silent.wav')), silent); assert.deepEqual(fs.readFileSync(path.join(outputDir, 'short.wav')), short);
});

test('FLAC, MP3, Vorbis and Opus retain format, channels and rate and pass encoded peak verification', t => {
    const { root, source, outputDir } = fixture(t), original = path.join(root, 'input.wav'); wav(original, { channels: 2 });
    for (const [name, codec] of [['sample.flac', 'flac'], ['sample.mp3', 'libmp3lame'], ['sample.ogg', 'libvorbis'], ['sample.opus', 'libopus']]) run(executable, ['-v', 'error', '-y', '-i', original, '-c:a', codec, path.join(source, name)]);
    const pipeline = ['flac', 'mp3', 'ogg'].map(type => step('audio-gain', { gainDb: 3, truePeakDb: -1 }, type, type));
    const { summary, records } = process(source, { pipeline, outputDir });
    assert.equal(summary.failed, 0, JSON.stringify(records)); assert.equal(summary.processed, 4);
    for (const row of records) {
        const audio = row.steps[0].metadata.audio;
        assert.equal(audio.before.codec, audio.after.codec); assert.equal(audio.after.channels, 2); assert.equal(audio.before.sampleRate, audio.after.sampleRate);
        assert.ok(audio.after.truePeakDb <= -1);
    }
});

test('audio writes require original preservation; no-op gain keeps exact compressed bytes', t => {
    const { root, source, outputDir } = fixture(t), input = path.join(root, 'input.wav'); wav(input);
    const filename = path.join(source, 'sample.mp3'); run(executable, ['-v', 'error', '-i', input, '-c:a', 'libmp3lame', filename]);
    const original = fs.readFileSync(filename), pipeline = [step('audio-gain', { gainDb: 0 }, 'mp3')];
    assert.throws(() => processFolder(source, { pipeline, log() {} }), /保留原文件/);
    const { summary } = process(source, { pipeline, outputDir });
    assert.equal(summary.processed, 0); assert.deepEqual(fs.readFileSync(path.join(outputDir, 'sample.mp3')), original);
    assert.throws(() => normalizePipeline([step('audio-gain', { gainDb: 31 })]));
    assert.throws(() => normalizePipeline([step('audio-normalize', { peakPolicy: 'compress' })]));
});

test('persistent audio reports expose measured results; failed later steps rollback and backups restore', t => {
    const { root, source } = fixture(t), filename = path.join(source, 'source.wav'), original = wav(filename);
    const core = path.join(copyTool(root, false, true), 'resource-core'), batch = require(path.join(core, 'batch'));
    const job = request => batch.runJob(request, fs.mkdtempSync(path.join(root, 'job-')), path.join(root, 'reports'));
    const pipeline = [step('audio-analyze'), step('audio-gain', { gainDb: 4 }), step('audio-analyze', {}, 'wav', 'after')];
    const result = job({ mode: 'process', folder: source, pipeline, backupDir: path.join(root, 'backups') });
    assert.equal(result.exitCode, 0, result.error); assert.equal(result.summary.backedUp, 1); assert.equal(result.audioResults.length, 3);
    assert.equal(result.audioResults[2].before.integratedLufs, result.audioResults[1].after.integratedLufs);
    assert.ok(fs.existsSync(path.join(result.reportDirectory, 'audio.csv')));
    assert.ok(fs.readFileSync(path.join(result.reportDirectory, 'audio.csv'), 'utf8').includes('appliedGainDb'));
    const restored = job({ mode: 'restore', taskFile: result.task.taskFile }); assert.equal(restored.summary.restored, 1); assert.deepEqual(fs.readFileSync(filename), original);
    const failed = job({ mode: 'process', folder: source, backupDir: path.join(root, 'backups'), pipeline: [step('audio-gain', { gainDb: 3 }), step('audio-gain', { gainDb: 30, peakPolicy: 'reject' }, 'wav', 'later')] });
    assert.equal(failed.summary.failed, 1); assert.equal(failed.summary.backedUp, 0); assert.deepEqual(fs.readFileSync(filename), original);
    assert.ok(failed.audioResults.every(row => row.fileStatus === 'failed'));
});

test('observation contract refuses output writes; cancellation remains at file boundaries', t => {
    const { source, outputDir } = fixture(t); wav(path.join(source, 'a.wav')); wav(path.join(source, 'b.wav'));
    const adapter = providers.get('ffmpeg').adapters['audio-analyze'];
    const bad = t.mock.method(adapter, 'execute', ({ output }) => { fs.writeFileSync(output, 'bad'); return { output, metadata: {} }; });
    const invalid = process(source, { pipeline: [step('audio-analyze')], outputDir });
    assert.equal(invalid.summary.failed, 2); assert.equal(fs.existsSync(outputDir), false); bad.mock.restore();
    const modifying = t.mock.method(adapter, 'execute', ({ input }) => { fs.writeFileSync(input, 'changed'); return { metadata: {} }; });
    assert.equal(process(source, { pipeline: [step('audio-analyze')], outputDir }).summary.failed, 2); modifying.mock.restore();
    let cancelled = false, done = 0;
    const summary = processFolder(source, { pipeline: [step('audio-gain', { gainDb: -3 })], outputDir, log() {}, shouldCancel: () => cancelled, onFile() { done++; cancelled = true; } });
    assert.equal(done, 1); assert.equal(summary.cancelled, true); assert.equal(fs.existsSync(path.join(outputDir, 'b.wav')), false);
});

test('operation API 2 gates observation and original-preservation declarations', t => {
    const { root } = fixture(t);
    for (const name of ['resource-types', 'operations/probe', 'providers']) fs.mkdirSync(path.join(root, name), { recursive: true });
    const filename = path.join(root, 'operations/probe/index.js');
    const check = definition => {
        fs.writeFileSync(filename, 'module.exports = ' + JSON.stringify({ version: '1.0.0', displayName: '测试分析', accepts: ['audio'], ...definition }));
        delete require.cache[filename]; return createRegistry(root);
    };
    assert.throws(() => check({ apiVersion: 1, resultPolicy: 'observe' }), /操作定义无效/);
    assert.throws(() => check({ apiVersion: 1, resultPolicy: 'valid-output', preserveOriginal: true }), /API 2/);
    assert.throws(() => check({ apiVersion: 2, resultPolicy: 'valid-output', preserveOriginal: 'yes' }), /布尔/);
    assert.throws(() => check({ apiVersion: 3, resultPolicy: 'observe' }), /扩展契约/);
    assert.equal(check({ apiVersion: 2, resultPolicy: 'observe' }).operations.get('probe').resultPolicy, 'observe');
});
