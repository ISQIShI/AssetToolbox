const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { discoverProcessors } = require('../framework/registry');
const { copyTool } = require('./portable');

function temporary(t) {
    const parent = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(parent, 'compress-discovery-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(root)), parent);
        assert.ok(path.basename(root).startsWith('compress-discovery-test-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    return root;
}
function run(executable, args, cwd, expected = 0) {
    const result = spawnSync(executable, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(result.status, expected, result.stdout + '\n' + result.stderr);
    return result.stdout;
}
function node(tool, script, args = [], expected = 0) {
    return run(process.execPath, [path.join(tool, 'resource-core', script), ...args], tool, expected);
}
function settings(tool) { return JSON.parse(node(tool, 'settings.js', ['--load'])).config; }
function definition() {
    return {
        displayName: '测试压缩器', description: '自动发现的整数、小数、开关、枚举和文本控件。',
        order: 5, extensions: ['.pack'], enabledKey: 'extraEnabled',
        defaults: { extraEnabled: false, extraLevel: 4, extraRate: 0.5, extraFlag: false, extraMode: 'fast', extraText: '初始值' },
        limits: { extraLevel: { label: '压缩级别', min: 1, max: 9 }, extraRate: { label: '比例', min: 0, max: 1 } },
        parameters: {
            extraRate: { type: 'number', decimalPlaces: 2, step: 0.05 },
            extraFlag: { label: '额外选项' },
            extraMode: { label: '模式', type: 'enum', choices: [{ label: '快速', value: 'fast' }, { label: '最佳', value: 'best' }] },
            extraText: { label: '标记', type: 'text', maxLength: 200 },
        },
    };
}
function addModule(tool, id = 'extra', config = definition()) {
    const directory = path.join(tool, 'resource-core/processors', id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'config.js'), 'module.exports = ' + JSON.stringify(config) + `;
module.exports.validate = settings => {
    if (settings.extraMode === 'best' && settings.extraLevel < 3) throw new Error('最佳模式要求级别至少为 3');
};
`);
    fs.writeFileSync(path.join(directory, 'index.js'), `const fs = require('node:fs');
const path = require('node:path');
module.exports = {
    validate: data => data.subarray(0, 5).toString() === 'PACK:',
    compress({ input, output, settings }) {
        if (path.extname(input) !== '.pack') throw new Error('wrong staging extension');
        fs.writeFileSync(output, 'PACK:' + JSON.stringify(Object.fromEntries(Object.entries(settings).filter(([key]) => key.startsWith('extra')))));
        return { output };
    }
};`);
    return directory;
}

test('discovers new module automatically; Node flags reach compression and module settings persist', { skip: process.platform !== 'win32' }, t => {
    const root = temporary(t), tool = copyTool(root);
    addModule(tool);
    const description = JSON.parse(node(tool, 'settings.js', ['--describe']));
    assert.equal(description.modules[0].id, 'extra');
    assert.equal(description.modules[0].displayName, '测试压缩器');
    assert.deepEqual(description.modules[0].extensions, ['.pack']);
    assert.match(node(tool, 'compress.js', ['--help']), /--extra-level/);
    const source = path.join(root, '输入'), output = path.join(root, '输出');
    fs.mkdirSync(path.join(source, '子目录'), { recursive: true });
    const input = path.join(source, '子目录', 'item.PACK');
    const original = Buffer.from('PACK:' + 'x'.repeat(4096));
    fs.writeFileSync(input, original);
    const marker = '中文 空格 "引号" \\';
    const values = { extraEnabled: true, extraLevel: 6, extraRate: 0.75, extraFlag: true, extraMode: 'best', extraText: marker };
    node(tool, 'compress.js', [source, '--output', output, '--extra-enabled', 'true', '--extra-level', '6', '--extra-rate', '0.75', '--extra-flag', 'true', '--extra-mode', 'best', '--extra-text', marker]);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output, '子目录/item.PACK'), 'utf8').slice(5)), values);
    assert.deepEqual(fs.readFileSync(input), original);
    node(tool, 'settings.js', ['--save-base64', Buffer.from(JSON.stringify({ ...settings(tool), ...values })).toString('base64')]);
    for (const [key, value] of Object.entries(values)) assert.equal(settings(tool)[key], value);
    const ownConfig = JSON.parse(fs.readFileSync(path.join(tool, 'resource-core/processors/extra/user-settings.json')));
    assert.deepEqual(ownConfig, { version: 1, ...values });
    const backup = path.join(root, '备份');
    node(tool, 'compress.js', [source, '--backup', backup, '--extra-enabled', 'true']);
    assert.deepEqual(fs.readFileSync(path.join(backup, fs.readdirSync(backup)[0], '子目录/item.PACK')), original);
});

test('ignores nonmodules and disabled directories; rejects incomplete modules, conflicts and malformed schemas', t => {
    const root = temporary(t), tool = copyTool(root), moduleRoot = path.join(tool, 'resource-core/processors');
    for (const id of ['_disabled', '.hidden', 'assets']) fs.mkdirSync(path.join(moduleRoot, id));
    fs.writeFileSync(path.join(moduleRoot, '_disabled/index.js'), 'invalid javascript');
    assert.equal(discoverProcessors(moduleRoot).processors.length, 3);
    const cases = [
        ['duplicate-extension', { ...definition(), extensions: ['.PNG'] }, /扩展名/],
        ['duplicate-parameter', { ...definition(), defaults: { ...definition().defaults, pngSpeed: true } }, /参数名/],
        ['reserved', { ...definition(), defaults: { ...definition().defaults, sourceDir: '' } }, /保留/],
        ['bad-type', { ...definition(), parameters: { extraLevel: { type: 'slider' } } }, /类型/],
        ['bad-default', { ...definition(), defaults: { ...definition().defaults, extraLevel: 500 } }, /整数/],
        ['missing-enable', { ...definition(), enabledKey: 'missing' }, /enabledKey/],
        ['bad-step', { ...definition(), parameters: { extraRate: { type: 'number', decimalPlaces: 2, step: 0.001 } } }, /精度/],
    ];
    cases.forEach(([name, config, error], index) => {
        const next = copyTool(path.join(root, String(index)));
        addModule(next, name, config);
        assert.throws(() => discoverProcessors(path.join(next, 'resource-core/processors')), error);
    });
    fs.mkdirSync(path.join(moduleRoot, 'incomplete'));
    fs.writeFileSync(path.join(moduleRoot, 'incomplete/config.js'), 'module.exports = {}');
    assert.throws(() => discoverProcessors(moduleRoot), /同时提供/);
});

test('removing or disabling a module hides its controls/options and preserves its saved settings', { skip: process.platform !== 'win32' }, t => {
    const root = temporary(t), tool = copyTool(root), directory = addModule(tool);
    const active = settings(tool);
    active.extraLevel = 8;
    node(tool, 'settings.js', ['--save-base64', Buffer.from(JSON.stringify(active)).toString('base64')]);
    const before = fs.readFileSync(path.join(directory, 'user-settings.json'));
    const moduleRoot = path.join(tool, 'resource-core/processors');
    const inactive = path.join(moduleRoot, '_extra');
    assert.equal(path.dirname(fs.realpathSync(directory)), fs.realpathSync(moduleRoot));
    assert.equal(path.dirname(inactive), moduleRoot);
    fs.renameSync(directory, inactive);
    assert.equal(Object.hasOwn(settings(tool), 'extraLevel'), false);
    assert.doesNotMatch(node(tool, 'compress.js', ['--help']), /extra-level/);
    assert.deepEqual(fs.readFileSync(path.join(inactive, 'user-settings.json')), before);
    fs.renameSync(inactive, directory);
    assert.equal(settings(tool).extraLevel, 8);
    for (const id of ['extra', 'png', 'jpg', 'mp3']) {
        const from = path.join(moduleRoot, id), to = path.join(moduleRoot, '_' + id);
        assert.equal(path.dirname(fs.realpathSync(from)), fs.realpathSync(moduleRoot));
        assert.equal(path.dirname(to), moduleRoot);
        fs.renameSync(from, to);
    }
    assert.deepEqual(JSON.parse(node(tool, 'settings.js', ['--describe'])).modules, []);

});

test('dynamic validation rejects invalid values and custom constraints before output/config writes', { skip: process.platform !== 'win32' }, t => {
    const root = temporary(t), tool = copyTool(root);
    addModule(tool);
    const source = path.join(root, 'source'), output = path.join(root, 'output');
    fs.mkdirSync(source);
    for (const args of [['--extra-rate', '0.123'], ['--extra-flag', 'yes'], ['--extra-mode', 'invalid'], ['--extra-level', '1', '--extra-mode', 'best']]) {
        node(tool, 'compress.js', [source, '--output', output, ...args], 1);
        assert.equal(fs.existsSync(output), false);
    }
    assert.equal(fs.existsSync(output), false);
    assert.equal(fs.existsSync(path.join(tool, 'resource-core/config/user-settings.json')), false);
});
