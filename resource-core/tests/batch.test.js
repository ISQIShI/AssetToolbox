const { compressionPipeline, engineFor, batchFor, installType } = require('./helpers');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { copyTool } = require('./portable');

function fixture(t, delay = 0) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'compress-batch-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(root)), parent);
        assert.ok(path.basename(root).startsWith('compress-batch-test-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const tool = copyTool(root), module = path.join(tool, 'resource-core/providers/fixture');
    fs.mkdirSync(module); installType(tool, 'fixture');
    fs.writeFileSync(path.join(module, 'config.js'), 'module.exports = ' + JSON.stringify({
        displayName: '批量测试模块', extensions: ['.pack'], enabledKey: 'fixtureEnabled', defaults: {},
    }));
    fs.writeFileSync(path.join(module, 'index.js'), `const fs = require('node:fs'); module.exports = {
        apiVersion:2,version:'1.0.0',displayName:'测试提供方',adapters:{'compress':{version:'1.0.0',resourceTypes:['fixture'],schema:require('./config'),
        execute({input, output}) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${delay});
            fs.writeFileSync(output, fs.readFileSync(input).subarray(0, 8)); return {output};
        }
    }}};`);
    const source = path.join(root, '中文 素材'); fs.mkdirSync(path.join(source, '子目录'), { recursive: true });
    const original = Buffer.from('PACK:' + 'test'.repeat(100));
    for (const name of ['a', 'b', 'c', 'd', '=formula']) fs.writeFileSync(path.join(source, '子目录', name + '.PACK'), original);
    return { root, tool, source, original, core: engineFor(path.join(tool, 'resource-core')), batch: batchFor(path.join(tool, 'resource-core')) };
}
function tree(root) {
    return fs.readdirSync(root, { recursive: true }).sort();
}
function jobDirectory(root) { const job = path.join(root, 'job'); fs.mkdirSync(job); return job; }
test('preview uses discovered modules, excludes nested destinations and never changes input/output/configuration', t => {
    const { root, tool, source, original, core } = fixture(t);
    const output = path.join(source, '结果'), before = tree(tool);
    fs.mkdirSync(path.join(output, '子目录'), { recursive: true });
    fs.writeFileSync(path.join(output, '子目录/a.PACK'), 'existing');
    fs.writeFileSync(path.join(source, 'ignored.txt'), 'ignored');
    const entries = tree(source);
    const preview = core.scanFolder(source, { outputDir: output });
    assert.equal(preview.total, 5); assert.equal(preview.enabledFiles, 5);
    assert.equal(preview.totalBytes, original.length * 5); assert.equal(preview.conflicts, 1);
    assert.equal(preview.resources[0].id, 'fixture'); assert.match(preview.issues[0], /a.PACK/);
    assert.deepEqual(tree(source), entries); assert.deepEqual(tree(tool), before);
    const absent = path.join(root, '未创建');
    assert.equal(core.scanFolder(source, { backupDir: absent, fixtureEnabled: false }).enabledFiles, 0);
    assert.equal(fs.existsSync(absent), false);
    assert.throws(() => core.scanFolder(source, { outputDir: source }), /不能/);
});

test('preview finds a blocked parent directory and missing enabled encoder; disabled encoder is not required', t => {
    const { root, source, tool, core } = fixture(t);
    const output = path.join(root, 'result'); fs.mkdirSync(output); fs.writeFileSync(path.join(output, '子目录'), 'file');
    assert.equal(core.scanFolder(source, { outputDir: output }).conflicts, 5);
    fs.writeFileSync(path.join(source, 'a.png'), 'fixture');
    fs.unlinkSync(path.join(tool, 'resource-core/providers/pngquant/pngquant.exe'));
    assert.ok(core.scanFolder(source).issues.some(issue => /pngquant/.test(issue)));
    assert.equal(core.scanFolder(source, { pngEnabled: false }).issues.length, 0);
});

test('safe cancellation finishes one file and its backup; later originals remain untouched', t => {
    const { root, source, original, core } = fixture(t), records = [], events = [];
    const summary = core.processFolder(source, { backupDir: path.join(root, 'backup'), log() {},
        shouldCancel: () => records.length >= 1, onFile: file => records.push(file), onProgress: event => events.push(event) });
    assert.equal(summary.cancelled, true); assert.equal(summary.processed, 1); assert.equal(summary.failed, 0); assert.equal(summary.backedUp, 1);
    const names = core.collectResources(source).files;
    assert.equal(fs.readFileSync(names[0]).length, 8);
    for (const name of names.slice(1)) assert.deepEqual(fs.readFileSync(name), original);
    assert.deepEqual(fs.readFileSync(path.join(summary.backupDirectory, records[0].path)), original);
    assert.equal(records[0].status, 'processed'); assert.equal(records[0].backedUp, true);
    assert.equal(events.at(-1).processed, 1); assert.equal(events.at(-1).total, 5);
    assert.equal(tree(source).some(file => file.includes('.resource-process-')), false);
});

test('cancellation during scanning never starts compression or creates destinations', t => {
    const { root, source, original, core } = fixture(t); let cancel = false;
    const outputDir = path.join(root, 'output');
    const summary = core.processFolder(source, { outputDir, log() {}, shouldCancel: () => cancel, onProgress: () => { cancel = true; } });
    assert.equal(summary.cancelled, true); assert.equal(summary.processed, 0); assert.equal(fs.existsSync(outputDir), false);
    for (const file of core.collectResources(source).files) assert.deepEqual(fs.readFileSync(file), original);
});

test('worker reports successes, failed original copies and conflicts; report CSV is UTF-8 and formula-safe', t => {
    const { root, source, original, core, batch } = fixture(t);
    fs.writeFileSync(path.join(source, 'broken.pack'), 'broken');
    const outputDir = path.join(root, 'output'); fs.mkdirSync(path.join(outputDir, '子目录'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, '子目录/a.PACK'), 'existing');
    const job = jobDirectory(root), reports = path.join(root, 'reports');
    const state = batch.runJob({ mode: 'process', folder: source, outputDir, options: {} }, job, reports);
    assert.equal(state.done, true); assert.equal(state.exitCode, 1); assert.equal(state.summary.processed, 4); assert.equal(state.summary.failed, 2);
    assert.equal(state.summary.copied, 1); assert.equal(state.processed, 6);
    const report = JSON.parse(fs.readFileSync(path.join(state.reportDirectory, 'report.json')));
    assert.equal(report.files.length, 6); assert.equal(report.pipeline.find(step => step.resourceType === 'fixture').enabled, true);
    assert.ok(report.files.find(file => file.path === 'broken.pack').copied);
    assert.match(report.files.find(file => file.path === path.join('子目录', 'a.PACK')).message, /已存在/);
    assert.equal(fs.readFileSync(path.join(outputDir, '子目录/a.PACK'), 'utf8'), 'existing');
    for (const file of core.collectResources(source).files.filter(file => file.endsWith('.PACK'))) assert.deepEqual(fs.readFileSync(file), original);
    const csv = fs.readFileSync(path.join(state.reportDirectory, 'files.csv'), 'utf8');
    assert.ok(csv.startsWith('\uFEFF')); assert.match(csv, /失败|无效|有效/);
    const formulaReport = batch.writeReport(reports, { files: [{ path: '=cmd', message: '+123,"quoted"\nline' }] });
    const formulaCsv = fs.readFileSync(path.join(formulaReport, 'files.csv'), 'utf8');
    assert.match(formulaCsv, /"'=cmd"/); assert.match(formulaCsv, /"'\+123,""quoted""\nline"/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(job, 'status.json'))).done, true);
});

test('worker reports cancellation and fatal errors, and surfaces report write failures without changing compression results', t => {
    const { root, source, batch } = fixture(t), job = jobDirectory(root), reports = path.join(root, 'reports');
    fs.writeFileSync(path.join(job, 'cancel'), '');
    const cancelled = batch.runJob({ mode: 'process', folder: source }, job, reports);
    assert.equal(cancelled.exitCode, 2); assert.equal(cancelled.processed, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(cancelled.reportDirectory, 'report.json'))).cancelled, true);
    fs.unlinkSync(path.join(job, 'cancel'));
    const failed = batch.runJob({ mode: 'process', folder: source, outputDir: source }, job, reports);
    assert.equal(failed.exitCode, 1); assert.match(failed.error, /不能/); assert.ok(failed.reportDirectory);
    const blocked = path.join(root, 'blocked'); fs.writeFileSync(blocked, 'file');
    const completed = batch.runJob({ mode: 'process', folder: source, options: { fixtureEnabled: false } }, job, blocked);
    assert.equal(completed.exitCode, 0); assert.equal(completed.summary.skipped, 5); assert.match(completed.reportWarning, /报告保存失败/);
});

test('preview worker and --preview CLI are read-only and preserve caller parameters', t => {
    const { root, source, tool, batch } = fixture(t), before = tree(tool), job = jobDirectory(root), reports = path.join(root, 'reports');
    const status = batch.runJob({ mode: 'preview', folder: source, options: { fixtureEnabled: false } }, job, reports);
    assert.equal(status.preview.enabledFiles, 0); assert.equal(status.exitCode, 0); assert.equal(fs.existsSync(reports), false);
    assert.equal(status.processed, 5); assert.equal(status.total, 5); assert.equal(status.preview.checked, 5);
    assert.equal(status.current, '');
    const output = path.join(root, 'not-created');
    const pipelineFile = path.join(root, 'pipeline.json'); fs.writeFileSync(pipelineFile, JSON.stringify(compressionPipeline({ fixtureEnabled: false }, path.join(tool, 'resource-core'))));
    const result = spawnSync(process.execPath, [path.join(tool, 'resource-core/cli.js'), source, '--preview', '--pipeline', pipelineFile, '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).enabledFiles, 0);
    assert.equal(fs.existsSync(output), false); assert.deepEqual(tree(tool), before);
    const empty = path.join(root, 'empty'); fs.mkdirSync(empty);
    const emptyStatus = batch.runJob({ mode: 'preview', folder: empty }, job, reports);
    assert.equal(emptyStatus.processed, 0); assert.equal(emptyStatus.total, 0);
    assert.equal(emptyStatus.preview.checked, 0); assert.equal(emptyStatus.exitCode, 0);
});

test('cancelling during preview reports only files actually checked in final worker status', t => {
    const { root, source, batch } = fixture(t), job = jobDirectory(root);
    const originalStat = fs.statSync;
    let checked = 0;
    fs.statSync = (filename, ...args) => {
        const result = originalStat(filename, ...args);
        if (String(filename).startsWith(source + path.sep) && String(filename).endsWith('.PACK') && ++checked === 2) fs.writeFileSync(path.join(job, 'cancel'), '');
        return result;
    };
    try {
        const status = batch.runJob({ mode: 'preview', folder: source }, job, path.join(root, 'reports'));
        assert.equal(status.cancelled, true); assert.equal(status.exitCode, 2);
        assert.equal(status.total, 5); assert.equal(status.processed, 2); assert.equal(status.preview.checked, 2);
        assert.equal(status.current, '');
    } finally { fs.statSync = originalStat; }
});

test('transient Windows locks on progress status do not fail a completed task', t => {
    const { root, source, batch } = fixture(t), job = jobDirectory(root);
    const originalRename = fs.renameSync;
    let blocked = 0;
    fs.renameSync = (from, to) => {
        if (path.basename(from) === 'status.next' && blocked++ < 3) {
            const error = new Error('simulated Windows reader lock'); error.code = 'EPERM'; throw error;
        }
        return originalRename(from, to);
    };
    try {
        const result = batch.runJob({ mode: 'process', folder: source }, job, path.join(root, 'reports'));
        assert.equal(result.exitCode, 0); assert.equal(result.summary.processed, 5); assert.equal(result.task.completed, 5);
        assert.equal(JSON.parse(fs.readFileSync(path.join(job, 'status.json'))).done, true);
    } finally { fs.renameSync = originalRename; }
});

