const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const childProcess = require('node:child_process');
const { compressFolder, collectResources } = require('../compress');
const { defaultConfiguration, loadConfiguration, saveConfiguration } = require('../settings');
const { adapters } = require('../compressors');
const realSpawn = childProcess.spawnSync;
const project = path.resolve(__dirname, '../..');
const lame = path.join(project, 'resCompress/compressors/mp3/lame.exe');
const windows = { skip: process.platform !== 'win32' };

function temporary(t) {
    const parent = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(parent, 'resource-compress-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(root)), parent);
        assert.ok(path.basename(root).startsWith('resource-compress-test-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    return root;
}
function run(executable, args, cwd) {
    const result = realSpawn(executable, args, { cwd, windowsHide: true, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    return result;
}
function generateMp3(root, filename, frequency = 440) {
    const rate = 44100, seconds = 2, samples = rate * seconds;
    const wav = Buffer.alloc(44 + samples * 4);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32);
    wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 4, 40);
    for (let sample = 0; sample < samples; sample++) {
        const value = Math.round(Math.sin(sample * 2 * Math.PI * frequency / rate) * 16000);
        wav.writeInt16LE(value, 44 + sample * 4); wav.writeInt16LE(-value, 46 + sample * 4);
    }
    const input = path.join(root, 'generated.wav');
    fs.writeFileSync(input, wav);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    run(lame, ['-b', '192', input, filename], root);
    return fs.readFileSync(filename);
}
function decodeDuration(root, file) {
    const decoded = path.join(root, 'decoded.wav');
    run(lame, ['--decode', file, decoded], root);
    const data = fs.readFileSync(decoded);
    assert.equal(data.toString('ascii', 0, 4), 'RIFF');
    const seconds = data.readUInt32LE(40) / data.readUInt32LE(28);
    assert.ok(seconds > 1.8 && seconds < 2.2, `audio duration ${seconds}`);
}

test('configuration defaults, Unicode roundtrip, corrupt fallback and invalid save protection', t => {
    const root = temporary(t), file = path.join(root, 'config/user-settings.json');
    const warnings = [];
    const initial = loadConfiguration(root, message => warnings.push(message));
    assert.deepEqual(initial, defaultConfiguration());
    assert.deepEqual([initial.pngSpeed, initial.pngQualityMin, initial.pngQualityMax, initial.jpgQuality, initial.mp3Bitrate], [3, 50, 80, 5, 24]);
    assert.deepEqual([initial.pngEnabled, initial.jpgEnabled, initial.mp3Enabled], [true, true, false]);
    assert.equal(warnings.length, 0);
    const custom = { ...initial, sourceDir: 'D:\\原始 音乐\\素材', outputDir: 'D:\\导出', backupDir: 'D:\\备份',
        saveMode: 'saveAs', backupEnabled: true, pngSpeed: 11, jpgQuality: 8, mp3Bitrate: 96, pngEnabled: false, mp3Enabled: true };
    saveConfiguration(custom, root);
    assert.deepEqual(loadConfiguration(root), custom);
    const original = fs.readFileSync(file);
    assert.throws(() => saveConfiguration({ ...custom, mp3Bitrate: 500 }, root));
    assert.deepEqual(fs.readFileSync(file), original);
    fs.writeFileSync(file, '{broken json');
    assert.deepEqual(loadConfiguration(root, message => warnings.push(message)), { ...custom, sourceDir: '', outputDir: '', backupDir: '', saveMode: 'overwrite', backupEnabled: false });
    assert.equal(warnings.length, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken json');
});

test('three adapters expose an independent replaceable interface', () => {
    assert.deepEqual(adapters.map(adapter => adapter.id), ['png', 'jpg', 'mp3']);
    for (const adapter of adapters) {
        assert.equal(typeof adapter.compress, 'function');
        assert.equal(typeof adapter.validate, 'function');
        assert.equal(typeof adapter.isEnabled, 'function');
        assert.ok(adapter.extensions.length > 0);
    }
});

test('all disabled types need no executable and copy unchanged on save-as', windows, t => {
    const root = temporary(t), source = path.join(root, '源目录'), output = path.join(root, '输出');
    fs.mkdirSync(source);
    const names = ['a.PNG', 'b.JPG', 'c.JPEG', 'deep/music.MP3'];
    for (const name of names) {
        fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
        fs.writeFileSync(path.join(source, name), `unchanged ${name}`);
    }
    fs.writeFileSync(path.join(source, 'ignored.mp3.bak'), 'ignored');
    const spawn = t.mock.method(childProcess, 'spawnSync', () => { throw new Error('disabled adapter must not run'); });
    const options = { pngEnabled: false, jpgEnabled: false, mp3Enabled: false, log() {} };
    const overwrite = compressFolder(source, { ...options, backupDir: path.join(root, 'backup') });
    assert.equal(overwrite.skipped, 4); assert.equal(overwrite.failed, 0); assert.equal(overwrite.backedUp, 0);
    const exported = compressFolder(source, { ...options, outputDir: output });
    assert.equal(exported.copied, 4); assert.equal(exported.failed, 0);
    assert.equal(collectResources(source).files.length, 4);
    assert.equal(spawn.mock.callCount(), 0);
    for (const name of names) assert.deepEqual(fs.readFileSync(path.join(output, name)), fs.readFileSync(path.join(source, name)));
    assert.equal(fs.existsSync(path.join(output, 'ignored.mp3.bak')), false);
});

test('MP3 save-as uses legacy ABR arguments, preserves originals and nested identities, and decodes', windows, t => {
    const root = temporary(t), source = path.join(root, '中文 音乐'), output = path.join(source, '导出');
    const files = [path.join(source, '甲', '同名.MP3'), path.join(source, '乙', '同名.MP3')];
    const originals = files.map((file, index) => generateMp3(root, file, 440 + index * 220));
    fs.writeFileSync(path.join(source, 'ignored.png'), 'disabled PNG bytes');
    const calls = [];
    t.mock.method(childProcess, 'spawnSync', (executable, args, options) => {
        calls.push({ executable, args }); return realSpawn(executable, args, options);
    });
    const summary = compressFolder(source, { outputDir: output, pngEnabled: false, jpgEnabled: false, mp3Enabled: true, log() {} });
    assert.equal(summary.total, 3); assert.equal(summary.compressed, 2); assert.equal(summary.copied, 1); assert.equal(summary.failed, 0);
    assert.equal(calls.length, 2);
    for (const call of calls) {
        assert.equal(path.basename(call.executable), 'lame.exe');
        assert.deepEqual(call.args.slice(0, 4), ['-h', '--abr', '24', '--mp3input']);
    }
    const outputs = files.map(file => path.join(output, path.relative(source, file)));
    files.forEach((file, index) => {
        assert.deepEqual(fs.readFileSync(file), originals[index]);
        assert.ok(fs.statSync(outputs[index]).size < originals[index].length);
        decodeDuration(root, outputs[index]);
    });
    assert.notDeepEqual(fs.readFileSync(outputs[0]), fs.readFileSync(outputs[1]));
    assert.equal(collectResources(source, { exclude: [output] }).files.length, 3);
});

test('MP3 overwrite backs up exact originals, skips growth and protects source on backup failure', windows, t => {
    const root = temporary(t), source = path.join(root, 'source'), backup = path.join(source, 'backup');
    const file = path.join(source, 'deep', 'song.mp3');
    const original = generateMp3(root, file);
    const common = { mp3Enabled: true, backupDir: backup, log() {} };
    // ABR 是平均目标，简单音调不保证更大；补齐有效输出以确定性验证拒绝增大的结果。
    const mp3 = adapters.find(adapter => adapter.id === 'mp3');
    const encode = mp3.compress;
    const growth = t.mock.method(mp3, 'compress', args => {
        const result = encode(args);
        fs.appendFileSync(result.output, Buffer.alloc(original.length));
        return result;
    });
    const larger = compressFolder(source, { ...common, mp3Bitrate: 320 });
    growth.mock.restore();
    assert.equal(larger.compressed, 0); assert.equal(larger.backedUp, 0); assert.equal(larger.failed, 0);
    assert.deepEqual(fs.readFileSync(file), original);
    const open = fs.openSync;
    const failure = t.mock.method(fs, 'openSync', (name, ...args) => {
        if (typeof name === 'string' && name.startsWith(backup + path.sep)) throw new Error('simulated backup failure');
        return open(name, ...args);
    });
    const failed = compressFolder(source, common);
    failure.mock.restore();
    assert.equal(failed.failed, 1); assert.deepEqual(fs.readFileSync(file), original);
    const success = compressFolder(source, common);
    assert.equal(success.compressed, 1); assert.equal(success.backedUp, 1);
    assert.deepEqual(fs.readFileSync(path.join(success.backupDirectory, 'deep', 'song.mp3')), original);
    assert.ok(fs.statSync(file).size < original.length);
    decodeDuration(root, file);
});

test('corrupt MP3 remains unchanged and copies on save-as while valid audio continues', windows, t => {
    const root = temporary(t), source = path.join(root, 'source'), output = path.join(root, 'output');
    const file = path.join(source, 'z-good.mp3');
    generateMp3(root, file);
    const corrupt = Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00');
    fs.writeFileSync(path.join(source, 'a-bad.mp3'), corrupt);
    const result = compressFolder(source, { outputDir: output, mp3Enabled: true, log() {} });
    assert.equal(result.failed, 1); assert.equal(result.compressed, 1); assert.equal(result.copied, 1);
    assert.deepEqual(fs.readFileSync(path.join(source, 'a-bad.mp3')), corrupt);
    assert.deepEqual(fs.readFileSync(path.join(output, 'a-bad.mp3')), corrupt);
});

test('format switches and MP3 bitrate reject invalid API and command-line values before writes', t => {
    const root = temporary(t), output = path.join(root, 'output');
    for (const options of [{ mp3Bitrate: 7 }, { mp3Bitrate: 321 }, { mp3Bitrate: 24.5 }, { mp3Enabled: 'true' }, { pngEnabled: 0 }, { jpgEnabled: null }]) {
        assert.throws(() => compressFolder(path.join(root, 'missing'), { ...options, outputDir: output, log() {} }));
        assert.equal(fs.existsSync(output), false);
    }
    for (const args of [['--mp3-enabled', 'yes'], ['--png-enabled', '1'], ['--mp3-bitrate', '24.5'], ['--mp3-bitrate', '321']]) {
        const result = realSpawn(process.execPath, [path.join(project, 'resCompress/compress.js'), root, '--output', output, ...args], { encoding: 'utf8', windowsHide: true });
        assert.equal(result.status, 1); assert.equal(fs.existsSync(output), false);
    }
});
