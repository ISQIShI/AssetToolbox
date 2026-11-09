const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { adapters } = require('../compressors');
const { defaultConfiguration, loadConfiguration, saveConfiguration, configurationFiles } = require('../settings');
const { copyTool } = require('./portable');

function temporary(t) {
    const parent = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(parent, 'compress-layout-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(root)), parent);
        assert.ok(path.basename(root).startsWith('compress-layout-test-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    return root;
}
function customConfiguration() {
    return { ...defaultConfiguration(), sourceDir: 'D:\\中文 素材', outputDir: 'D:\\另存', backupDir: 'D:\\原图',
        saveMode: 'saveAs', backupEnabled: true, pngSpeed: 9, pngQualityMin: 20, pngQualityMax: 70,
        jpgQuality: 8, mp3Bitrate: 96, pngEnabled: false, mp3Enabled: true };
}
function run(executable, args, cwd) {
    const result = spawnSync(executable, args, { cwd, windowsHide: true, encoding: 'utf8', timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + '\n' + result.stderr);
    return result.stdout;
}

test('each module stores only its own options, and settings travel with a copied module', t => {
    const root = temporary(t), original = path.join(root, 'first'), copied = path.join(root, 'second');
    const config = customConfiguration();
    saveConfiguration(config, original);
    const files = configurationFiles(original);
    const shared = JSON.parse(fs.readFileSync(files.shared));
    assert.deepEqual(Object.keys(shared).sort(), ['version', 'sourceDir', 'outputDir', 'backupDir', 'saveMode', 'backupEnabled'].sort());
    for (const { adapter, filename } of files.modules) {
        const saved = JSON.parse(fs.readFileSync(filename));
        assert.deepEqual(Object.keys(saved).sort(), ['version', ...Object.keys(adapter.config.defaults)].sort());
        for (const key of Object.keys(adapter.config.defaults)) assert.equal(saved[key], config[key]);
        assert.ok(fs.existsSync(path.join(adapter.directory, adapter.executableName)));
        assert.ok(fs.existsSync(path.join(adapter.directory, 'config.js')));
    }
    fs.cpSync(path.join(original, 'compressors/png'), path.join(copied, 'compressors/png'), { recursive: true });
    assert.deepEqual(loadConfiguration(copied), { ...defaultConfiguration(), pngEnabled: false, pngSpeed: 9, pngQualityMin: 20, pngQualityMax: 70 });
});

test('corrupt module falls back independently and ignores unrelated fields', t => {
    const root = temporary(t), custom = customConfiguration(), warnings = [];
    saveConfiguration(custom, root);
    const files = configurationFiles(root);
    fs.writeFileSync(files.modules[0].filename, '{broken PNG');
    const jpg = files.modules[1].filename;
    fs.writeFileSync(jpg, JSON.stringify({ version: 1, jpgQuality: 8, jpgEnabled: true, mp3Bitrate: 320, sourceDir: 'wrong' }));
    assert.deepEqual(loadConfiguration(root, message => warnings.push(message)), { ...custom, ...adapters[0].config.defaults });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /PNG/);
    assert.equal(fs.readFileSync(files.modules[0].filename, 'utf8'), '{broken PNG');
});

test('old flat configuration loads without writes and migrates only on save', t => {
    const root = temporary(t), custom = customConfiguration(), files = configurationFiles(root);
    const oldBytes = Buffer.from('\ufeff' + JSON.stringify(custom, null, 2));
    fs.writeFileSync(files.legacy, oldBytes);
    assert.deepEqual(loadConfiguration(root), custom);
    assert.deepEqual(fs.readdirSync(root), ['user-settings.json']);
    saveConfiguration(custom, root);
    assert.deepEqual(fs.readFileSync(files.legacy), oldBytes);
    fs.writeFileSync(files.legacy, JSON.stringify(defaultConfiguration()));
    assert.deepEqual(loadConfiguration(root), custom, 'new files must win over the old configuration');
    fs.unlinkSync(files.modules[0].filename);
    assert.deepEqual(loadConfiguration(root), { ...custom, ...adapters[0].config.defaults });
});

test('partial configuration commit rolls back all earlier files', t => {
    const root = temporary(t), oldConfig = customConfiguration();
    saveConfiguration(oldConfig, root);
    const files = configurationFiles(root);
    const paths = [files.shared, ...files.modules.map(item => item.filename)];
    const before = paths.map(filename => fs.readFileSync(filename));
    const rename = fs.renameSync;
    const fault = t.mock.method(fs, 'renameSync', (source, target) => {
        if (target === files.modules[2].filename) throw new Error('simulated module write failure');
        return rename(source, target);
    });
    assert.throws(() => saveConfiguration({ ...oldConfig, pngSpeed: 1, jpgQuality: 2, mp3Bitrate: 128 }, root), /simulated/);
    fault.mock.restore();
    paths.forEach((filename, index) => {
        assert.deepEqual(fs.readFileSync(filename), before[index]);
        assert.deepEqual(fs.readdirSync(path.dirname(filename)), ['user-settings.json']);
    });
    assert.deepEqual(loadConfiguration(root), oldConfig);
});

test('module defaults/ranges drive Node after relocating the tool', { skip: process.platform !== 'win32' }, t => {
    const root = temporary(t), portable = copyTool(root), moved = path.join(root, '中文 工具');
    assert.equal(path.dirname(fs.realpathSync(portable)), root);
    assert.equal(path.dirname(moved), root);
    fs.renameSync(portable, moved);
    const configFile = path.join(moved, 'resCompress/compressors/jpg/config.js');
    const original = fs.readFileSync(configFile, 'utf8');
    fs.writeFileSync(configFile, original.replace('jpgQuality: 5', 'jpgQuality: 8').replace('max: 9', 'max: 8'));
    const description = JSON.parse(run(process.execPath, [path.join(moved, 'resCompress/settings.js'), '--describe'], root));
    assert.equal(description.defaults.jpgQuality, 8);
    assert.equal(description.limits.jpgQuality.max, 8);
    const loaded = JSON.parse(run(process.execPath, [path.join(moved, 'resCompress/settings.js'), '--load'], root));
    assert.equal(loaded.config.jpgQuality, 8);
    const source = path.join(root, 'empty');
    fs.mkdirSync(source);
    const invalid = spawnSync(process.execPath, [path.join(moved, 'resCompress/compress.js'), source, '--jpg-quality', '9'], { encoding: 'utf8', windowsHide: true });
    assert.equal(invalid.status, 1);
});
