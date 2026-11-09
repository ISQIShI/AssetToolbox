const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { processors } = require('../framework/registry');
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
    for (const { processor, filename } of files.modules) {
        const saved = JSON.parse(fs.readFileSync(filename));
        assert.deepEqual(Object.keys(saved).sort(), ['version', ...Object.keys(processor.config.defaults)].sort());
        for (const key of Object.keys(processor.config.defaults)) assert.equal(saved[key], config[key]);
        assert.ok(fs.existsSync(path.join(processor.directory, processor.executableName)));
        assert.ok(fs.existsSync(path.join(processor.directory, 'config.js')));
    }
    fs.cpSync(path.join(original, 'processors/png'), path.join(copied, 'processors/png'), { recursive: true });
    assert.deepEqual(loadConfiguration(copied), { ...defaultConfiguration(), pngEnabled: false, pngSpeed: 9, pngQualityMin: 20, pngQualityMax: 70 });
});

test('corrupt module falls back independently and ignores unrelated fields', t => {
    const root = temporary(t), custom = customConfiguration(), warnings = [];
    saveConfiguration(custom, root);
    const files = configurationFiles(root);
    fs.writeFileSync(files.modules[0].filename, '{broken PNG');
    const jpg = files.modules[1].filename;
    fs.writeFileSync(jpg, JSON.stringify({ version: 1, jpgQuality: 8, jpgEnabled: true, mp3Bitrate: 320, sourceDir: 'wrong' }));
    assert.deepEqual(loadConfiguration(root, message => warnings.push(message)), { ...custom, ...processors[0].config.defaults });
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
    assert.deepEqual(loadConfiguration(root), { ...custom, ...processors[0].config.defaults });
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
    const configFile = path.join(moved, 'resource-core/processors/jpg/config.js');
    const original = fs.readFileSync(configFile, 'utf8');
    fs.writeFileSync(configFile, original.replace('jpgQuality: 5', 'jpgQuality: 8').replace('max: 9', 'max: 8'));
    const description = JSON.parse(run(process.execPath, [path.join(moved, 'resource-core/settings.js'), '--describe'], root));
    assert.equal(description.defaults.jpgQuality, 8);
    assert.equal(description.limits.jpgQuality.max, 8);
    const loaded = JSON.parse(run(process.execPath, [path.join(moved, 'resource-core/settings.js'), '--load'], root));
    assert.equal(loaded.config.jpgQuality, 8);
    const source = path.join(root, 'empty');
    fs.mkdirSync(source);
    const invalid = spawnSync(process.execPath, [path.join(moved, 'resource-core/compress.js'), source, '--jpg-quality', '9'], { encoding: 'utf8', windowsHide: true });
    assert.equal(invalid.status, 1);
});

test('legacy directory relocation preserves v2 settings and v1 task bytes and resumes the old plan', t => {
    const root = temporary(t), tool = copyTool(root);
    const core = path.join(tool, 'resource-core'), legacy = path.join(tool, 'resCompress');
    const source = path.join(root, '素材'), output = path.join(root, '输出');
    fs.mkdirSync(source);
    const bytes = Buffer.from('unchanged disabled PNG fixture');
    const input = path.join(source, 'old.png'); fs.writeFileSync(input, bytes);
    const info = fs.statSync(input);
    // 固定旧磁盘契约，不调用新版配置/任务写入器生成测试数据。
    const settings = { version: 2, sourceDir: source, outputDir: output, backupDir: '', saveMode: 'saveAs', backupEnabled: false };
    const moduleSettings = { version: 1, pngEnabled: false, pngSpeed: 9, pngQualityMin: 20, pngQualityMax: 70 };
    const header = { version: 1, id: 'legacy-task', createdAt: '2026-01-01T00:00:00.000Z', source,
        outputDir: output, backupDir: null, backupSession: null,
        options: { pngEnabled: false, pngSpeed: 9, pngQualityMin: 20, pngQualityMax: 70, jpgEnabled: false, jpgQuality: 5, mp3Enabled: false, mp3Bitrate: 24 } };
    const plan = { type: 'plan', files: [{ path: 'old.png', module: 'png', snapshot: { size: info.size, mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs } }] };
    assert.equal(path.dirname(core), tool); assert.equal(path.dirname(legacy), tool);
    fs.renameSync(core, legacy);
    fs.renameSync(path.join(legacy, 'processors'), path.join(legacy, 'compressors'));
    const files = new Map([
        ['config/user-settings.json', Buffer.from('\ufeff' + JSON.stringify(settings))],
        ['compressors/png/user-settings.json', Buffer.from(JSON.stringify(moduleSettings))],
        ['tasks/legacy-task/task.json', Buffer.from(JSON.stringify(header))],
        ['tasks/legacy-task/events.jsonl', Buffer.from(JSON.stringify(plan) + '\n')],
        ['reports/old/report.json', Buffer.from(JSON.stringify({ taskFile: path.join(legacy, 'tasks/legacy-task/task.json') }))],
    ]);
    for (const [relative, data] of files) {
        const filename = path.join(legacy, relative);
        fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, data);
    }
    fs.renameSync(legacy, core);
    fs.renameSync(path.join(core, 'compressors'), path.join(core, 'processors'));
    const loaded = JSON.parse(run(process.execPath, [path.join(core, 'settings.js'), '--load'], root));
    assert.equal(loaded.config.sourceDir, source); assert.equal(loaded.config.pngSpeed, 9);
    assert.equal(loaded.config.pngEnabled, false); assert.deepEqual(loaded.warnings, []);
    const tasks = require(path.join(core, 'tasks'));
    const [task] = tasks.listTasks();
    assert.equal(task.taskFile, path.join(core, 'tasks/legacy-task/task.json'));
    assert.equal(task.pending, 1);
    for (const [relative, data] of files) assert.deepEqual(fs.readFileSync(path.join(core, relative.replace(/^compressors\//, 'processors/'))), data);
    run(process.execPath, [path.join(core, 'batch.js'), '--resume', task.taskFile], root);
    assert.deepEqual(fs.readFileSync(path.join(output, 'old.png')), bytes);
    assert.deepEqual(fs.readFileSync(input), bytes);
    assert.equal(tasks.listTasks()[0].pending, 0);
    assert.deepEqual(fs.readFileSync(task.taskFile), files.get('tasks/legacy-task/task.json'));
});
