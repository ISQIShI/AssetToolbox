const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { copyTool } = require('./portable');

function fixture(t) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'restore-preview-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(root)), parent);
        assert.ok(path.basename(root).startsWith('restore-preview-test-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const tool = copyTool(root), tasks = require(path.join(tool, 'resCompress/tasks')), restore = require(path.join(tool, 'resCompress/restore'));
    const batch = require(path.join(tool, 'resCompress/batch')), source = path.join(root, '中文 素材'), backupDir = path.join(root, '备份');
    fs.mkdirSync(path.join(source, '二级'), { recursive: true });
    const task = tasks.createTask({ root: source, outputRoot: null, backupRoot: backupDir, settings: {} }), unlock = task.lock();
    const originals = new Map(), compressed = new Map(), names = ['a.png', 'b.jpg', 'c.mp3', 'd.extra'];
    const paths = names.map(name => path.join('二级', name));
    try {
        task.append({ type: 'plan', files: paths.map(relative => ({ path: relative, module: 'fixture', snapshot: { size: 100, mtimeMs: 0, ctimeMs: 0 } })) });
        for (const relative of paths) {
            const original = Buffer.from('original:' + relative.repeat(10)), smaller = Buffer.from('compressed:' + relative);
            originals.set(relative, original); compressed.set(relative, smaller);
            const backup = path.join(task.header.backupSession, relative);
            fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, original); fs.writeFileSync(path.join(source, relative), smaller);
            const record = { path: relative, module: 'fixture', status: 'compressed', backedUp: true,
                sourceHash: tasks.digest(original), expectedHash: tasks.digest(smaller) };
            task.append({ type: 'intent', path: relative, record }); task.finish(record);
        }
    } finally { unlock(); }
    const taskFile = task.taskFile, backup = task.header.backupSession;
    const run = request => batch.runJob(request, fs.mkdtempSync(path.join(root, 'job-')), path.join(root, 'reports'));
    const preview = () => run({ mode: 'restore-preview', taskFile });
    return { root, tool, source, backup, taskFile, tasks, restore, batch, originals, compressed, paths, run, preview };
}
const select = file => ({ path: file.path, backupHash: file.backupHash, targetHash: file.targetHash });
function execute(f, files) { return f.run({ mode: 'restore', taskFile: f.taskFile, selection: files.map(select) }); }
function sourceBytes(f, index) { return fs.readFileSync(path.join(f.source, f.paths[index])); }
test('preview classifies current content, missing targets and conflicts without writing task, assets, backup or reports', t => {
    const f = fixture(t), journal = path.join(path.dirname(f.taskFile), 'events.jsonl');
    fs.writeFileSync(path.join(f.source, f.paths[1]), f.originals.get(f.paths[1]));
    fs.writeFileSync(path.join(f.source, f.paths[2]), 'edited'); fs.unlinkSync(path.join(f.source, f.paths[3]));
    const before = fs.readFileSync(journal), entries = fs.readdirSync(path.dirname(journal));
    const result = f.preview(), p = result.preview;
    assert.equal(result.exitCode, 0, result.error);
    assert.deepEqual([p.total, p.checked, p.recoverable, p.restored, p.conflict], [4, 4, 2, 1, 1]);
    assert.deepEqual(p.files.map(file => file.selectable), [true, false, false, true]);
    assert.match(p.files[2].reason, /已被修改/); assert.equal(p.files[3].targetHash, null);
    assert.deepEqual(fs.readFileSync(journal), before); assert.deepEqual(fs.readdirSync(path.dirname(journal)), entries);
    assert.equal(fs.existsSync(path.join(f.root, 'reports')), false); assert.equal(f.tasks.loadTask(f.taskFile).restoreStarted, false);
    assert.equal(fs.existsSync(path.join(f.source, f.paths[3])), false);
    for (const [relative, bytes] of f.originals) assert.deepEqual(fs.readFileSync(path.join(f.backup, relative)), bytes);
});

test('completed restoration is shown, but later edits or deletion become unselectable conflicts', t => {
    const f = fixture(t), initial = f.preview().preview;
    assert.equal(execute(f, initial.files).summary.restored, 4);
    assert.equal(f.preview().preview.restored, 4);
    fs.writeFileSync(path.join(f.source, f.paths[0]), f.compressed.get(f.paths[0])); fs.unlinkSync(path.join(f.source, f.paths[1]));
    const p = f.preview().preview; assert.equal(p.conflict, 2); assert.equal(p.restored, 2);
    assert.match(p.files[0].reason, /已恢复过/); assert.equal(p.files[0].selectable, false);
    assert.equal(execute(f, [initial.files[0]]).summary.total, 0);
    assert.deepEqual(sourceBytes(f, 0), f.compressed.get(f.paths[0]));
});

test('corrupt and missing backup files, including a missing whole session, appear as conflicts', t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.backup, f.paths[0]), 'corrupt'); fs.unlinkSync(path.join(f.backup, f.paths[1]));
    assert.equal(f.preview().preview.conflict, 2);
    const moved = path.join(f.root, 'moved-backup'); fs.renameSync(f.backup, moved);
    const p = f.preview().preview; assert.equal(p.conflict, 4); assert.equal(p.recoverable, 0);
    assert.equal(f.tasks.loadTask(f.taskFile).restoreStarted, false);
});

test('selective restore touches only checked files; an empty selection does not start restoration', t => {
    const f = fixture(t), p = f.preview().preview;
    const empty = execute(f, []); assert.equal(empty.summary.total, 0); assert.equal(empty.task.restoreStarted, false);
    const result = execute(f, [p.files[1], p.files[3]]);
    assert.equal(result.summary.restored, 2); assert.equal(result.task.restoreSelectedTotal, 2);
    for (const index of [0, 2]) assert.deepEqual(sourceBytes(f, index), f.compressed.get(f.paths[index]));
    for (const index of [1, 3]) assert.deepEqual(sourceBytes(f, index), f.originals.get(f.paths[index]));
    assert.equal(result.task.restorePending, 2); assert.equal(result.task.canContinueRestore, false);
    assert.equal(f.run({ mode: 'restore', taskFile: f.taskFile }).summary.total, 0);
    const next = f.preview().preview; assert.equal(next.files[0].inLastSelection, false); assert.equal(next.files[1].inLastSelection, true);
    assert.equal(execute(f, [next.files[0]]).summary.restored, 1);
    assert.deepEqual(sourceBytes(f, 2), f.compressed.get(f.paths[2]));
});

test('cancel and restart resumes only the persisted checked set, leaving unselected files untouched', t => {
    const f = fixture(t), selection = [0, 2, 3].map(index => select(f.preview().preview.files[index]));
    const task = f.tasks.loadTask(f.taskFile), unlock = task.lock(); let count = 0;
    try {
        const partial = f.restore.restoreTask(task, { selection, shouldCancel: () => count >= 1, onFile: () => { count++; } });
        assert.equal(partial.cancelled, true); assert.equal(task.info().restoreSelectedPending, 2);
    } finally { unlock(); }
    const result = spawnSync(process.execPath, [path.join(f.tool, 'resCompress/batch.js'), '--restore', f.taskFile], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).summary.restored, 2);
    assert.deepEqual(sourceBytes(f, 1), f.compressed.get(f.paths[1]));
    assert.equal(f.tasks.loadTask(f.taskFile).info().restoreSelectedPending, 0);
});

test('only failures within the checked set are retried; refreshed preview can explicitly select other failures', t => {
    const f = fixture(t), p = f.preview().preview;
    fs.writeFileSync(path.join(f.source, f.paths[1]), 'edited');
    const result = execute(f, [p.files[0], p.files[1]]); assert.equal(result.summary.failed, 1);
    fs.writeFileSync(path.join(f.source, f.paths[1]), f.compressed.get(f.paths[1]));
    const retry = f.run({ mode: 'restore-retry', taskFile: f.taskFile }); assert.equal(retry.summary.restored, 1);
    assert.deepEqual(sourceBytes(f, 2), f.compressed.get(f.paths[2]));
    assert.equal(f.tasks.loadTask(f.taskFile).info().restorePending, 2);
});

test('invalid, duplicate, traversal and unknown selections fail before writing any originals or restore records', t => {
    const f = fixture(t), file = select(f.preview().preview.files[0]);
    const cases = [null, 'a', [file, file], [file, { ...file, path: file.path.replaceAll('\\', '/') }], [{ ...file, path: '../outside.png' }], [{ ...file, path: 'unknown.png' }], [{ path: file.path }]];
    for (const selection of cases) {
        const result = f.run({ mode: 'restore', taskFile: f.taskFile, selection });
        assert.equal(result.exitCode, 1); assert.equal(f.tasks.loadTask(f.taskFile).restoreStarted, false);
        assert.deepEqual(sourceBytes(f, 0), f.compressed.get(f.paths[0]));
    }
});

test('files changed after preview are refused, but an already-original target is safely recognized', t => {
    const f = fixture(t), missing = path.join(f.source, f.paths[0]); fs.unlinkSync(missing);
    const p = f.preview().preview;
    fs.writeFileSync(missing, f.compressed.get(f.paths[0]));
    fs.writeFileSync(path.join(f.source, f.paths[1]), f.originals.get(f.paths[1]));
    const result = execute(f, [p.files[0], p.files[1]]);
    assert.equal(result.summary.failed, 1); assert.equal(result.summary.skipped, 1);
    assert.deepEqual(sourceBytes(f, 0), f.compressed.get(f.paths[0]));
    assert.equal(execute(f, [f.preview().preview.files[0]]).summary.restored, 1);
});

test('selected restoration recognizes a replacement committed before its result journal write failed', t => {
    const f = fixture(t), file = f.preview().preview.files[0], load = f.tasks.loadTask;
    f.tasks.loadTask = (...args) => {
        const task = load(...args), append = task.append;
        task.append = event => { if (event.type === 'restore-result') throw new Error('journal full'); append(event); }; return task;
    };
    const failed = execute(f, [file]); f.tasks.loadTask = load; assert.match(failed.error, /journal full/);
    const done = f.run({ mode: 'restore', taskFile: f.taskFile }); assert.equal(done.summary.skipped, 1); assert.equal(done.summary.total, 1);
    assert.deepEqual(sourceBytes(f, 1), f.compressed.get(f.paths[1]));
});

test('cancelled preview stays read-only and cannot return unchecked remainder as recoverable', t => {
    const f = fixture(t), task = f.tasks.loadTask(f.taskFile); let cancel = false;
    const p = f.restore.previewRestoreTask(task, { shouldCancel: () => cancel, onProgress: update => { if (update.processed === 1) cancel = true; } });
    assert.equal(p.cancelled, true); assert.ok(p.checked < p.total); assert.equal(p.files.length, p.checked);
    assert.equal(task.restoreStarted, false); assert.equal(fs.existsSync(path.join(path.dirname(f.taskFile), 'task.lock')), false);
});

test('old backup preview and selective export support arbitrary file types, protect existing files and detect changed backups', t => {
    const f = fixture(t), outputDir = path.join(f.root, 'export'); fs.mkdirSync(path.join(outputDir, '二级'), { recursive: true });
    fs.writeFileSync(path.join(outputDir, f.paths[1]), f.originals.get(f.paths[1])); fs.writeFileSync(path.join(outputDir, f.paths[2]), 'keep');
    const preview = f.run({ mode: 'restore-export-preview', backupDir: f.backup, outputDir }).preview;
    assert.deepEqual([preview.recoverable, preview.restored, preview.conflict], [2, 1, 1]);
    const result = f.run({ mode: 'restore-export', backupDir: f.backup, outputDir, selection: [select(preview.files[3])] });
    assert.equal(result.summary.restored, 1); assert.equal(fs.existsSync(path.join(outputDir, f.paths[0])), false);
    assert.equal(fs.readFileSync(path.join(outputDir, f.paths[2]), 'utf8'), 'keep');
    fs.writeFileSync(path.join(f.backup, f.paths[0]), 'changed backup');
    assert.equal(f.run({ mode: 'restore-export', backupDir: f.backup, outputDir, selection: [select(preview.files[0])] }).summary.failed, 1);
    assert.equal(fs.existsSync(path.join(outputDir, f.paths[0])), false);
});

test('CLI previews and accepts a Unicode JSON checked list without restoring other files', t => {
    const f = fixture(t), script = path.join(f.tool, 'resCompress/batch.js');
    const p = spawnSync(process.execPath, [script, '--restore-preview', f.taskFile], { encoding: 'utf8', windowsHide: true });
    assert.equal(p.status, 0, p.stderr);
    assert.equal(/[^\x00-\x7f]/.test(p.stdout), false, 'CLI JSON must survive legacy PowerShell native encoding');
    const selectionFile = path.join(f.root, '勾选 清单.json');
    fs.writeFileSync(selectionFile, '\uFEFF' + JSON.stringify([select(JSON.parse(p.stdout).preview.files[2])]));
    const run = spawnSync(process.execPath, [script, '--restore', f.taskFile, '--selection', selectionFile], { encoding: 'utf8', windowsHide: true });
    assert.equal(run.status, 0, run.stdout + run.stderr); assert.equal(JSON.parse(run.stdout).summary.restored, 1);
    assert.deepEqual(sourceBytes(f, 0), f.compressed.get(f.paths[0]));
});

