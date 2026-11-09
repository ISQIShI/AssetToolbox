const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { copyTool } = require('./portable');

function fixture(t) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'backup-restore-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(root)), parent);
        assert.ok(path.basename(root).startsWith('backup-restore-test-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const tool = copyTool(root), module = path.join(tool, 'resCompress/compressors/fixture');
    fs.mkdirSync(module);
    fs.writeFileSync(path.join(module, 'config.js'), 'module.exports=' + JSON.stringify({ displayName: '恢复测试', extensions: ['.pack'], enabledKey: 'fixtureEnabled', defaults: { fixtureEnabled: true } }));
    fs.writeFileSync(path.join(module, 'index.js'), `const fs=require('node:fs');module.exports={validate:d=>d.toString().startsWith('PACK:'),compress({input,output}){fs.writeFileSync(output,fs.readFileSync(input).subarray(0,10));return {output};}};`);
    const source = path.join(root, '原始 素材'), backupDir = path.join(root, '备份');
    fs.mkdirSync(path.join(source, '二级'), { recursive: true });
    const originals = new Map();
    for (const name of ['a', 'b', 'c']) {
        const relative = path.join('二级', name + '.pack'), data = Buffer.from('PACK:' + name.repeat(200));
        fs.writeFileSync(path.join(source, relative), data); originals.set(relative, data);
    }
    const batch = require(path.join(tool, 'resCompress/batch')), tasks = require(path.join(tool, 'resCompress/tasks'));
    const restore = require(path.join(tool, 'resCompress/restore'));
    const run = (request, cancelAfter = Infinity) => {
        const job = fs.mkdtempSync(path.join(root, 'job-')), original = restore.restoreTask;
        restore.restoreTask = (task, options) => {
            let count = 0;
            return original(task, { ...options, onFile: record => {
                options.onFile(record);
                if (++count === cancelAfter) fs.writeFileSync(path.join(job, 'cancel'), '');
            } });
        };
        try { return batch.runJob(request, job, path.join(root, 'reports')); }
        finally { restore.restoreTask = original; }
    };
    const first = run({ mode: 'compress', folder: source, backupDir });
    assert.equal(first.exitCode, 0, first.error); assert.equal(first.summary.backedUp, 3);
    const taskFile = first.task.taskFile, backup = tasks.loadTask(taskFile).header.backupSession;
    const recover = (mode = 'restore', cancelAfter = Infinity) => run({ mode, taskFile }, cancelAfter);
    return { root, tool, source, backup, originals, run, recover, taskFile, tasks, restore };
}
function report(state) { return JSON.parse(fs.readFileSync(path.join(state.reportDirectory, 'report.json'))); }
function verify(f) {
    for (const [relative, bytes] of f.originals) {
        assert.deepEqual(fs.readFileSync(path.join(f.source, relative)), bytes);
        assert.deepEqual(fs.readFileSync(path.join(f.backup, relative)), bytes);
    }
}

test('existing intent/result journals restore every original byte and keep backup hierarchy; repeat writes nothing', t => {
    const f = fixture(t), task = f.tasks.loadTask(f.taskFile);
    // 旧版结果没有 expectedHash；从更早的 intent 恢复校验信息。
    assert.equal(task.entries.values().next().value.record.expectedHash, undefined);
    assert.equal(task.info().backupCount, 3);
    const done = f.recover();
    assert.equal(done.exitCode, 0, done.error); assert.equal(done.summary.restored, 3);
    assert.equal(done.task.restored, 3); assert.equal(done.task.canRestore, false);
    assert.equal(done.task.canResume, false); assert.equal(done.task.canRetry, false);
    verify(f); assert.equal(report(done).files.length, 3);
    const one = path.join(f.source, '二级/a.pack'), stamp = fs.statSync(one).mtimeMs;
    assert.equal(f.recover().summary.total, 0); assert.equal(fs.statSync(one).mtimeMs, stamp);
    fs.writeFileSync(one, 'edited after restore');
    assert.equal(f.recover().summary.total, 0); assert.equal(fs.readFileSync(one, 'utf8'), 'edited after restore');
    assert.match(f.recover('resume').error, /不能继续压缩/);
    assert.match(f.recover('retry').error, /不能继续压缩/);
});

test('cancel and reopen continues only pending restore files and preserves already-restored edits', t => {
    const f = fixture(t), partial = f.recover('restore', 1);
    assert.equal(partial.exitCode, 2); assert.equal(partial.task.restored, 1); assert.equal(partial.task.restorePending, 2);
    const one = path.join(f.source, '二级/a.pack'); fs.writeFileSync(one, 'new edit');
    const command = spawnSync(process.execPath, [path.join(f.tool, 'resCompress/batch.js'), '--restore', f.taskFile], { encoding: 'utf8', windowsHide: true });
    assert.equal(command.status, 0, command.stderr);
    const state = JSON.parse(command.stdout); assert.equal(state.summary.total, 2); assert.equal(state.task.restored, 3);
    assert.equal(fs.readFileSync(one, 'utf8'), 'new edit');
});

test('changed targets and corrupt or missing backups are reported, and only failed restoration is retried', t => {
    const f = fixture(t), a = path.join(f.source, '二级/a.pack'), b = path.join(f.backup, '二级/b.pack'), c = path.join(f.backup, '二级/c.pack');
    const compressed = fs.readFileSync(a);
    fs.writeFileSync(a, 'user edit'); fs.writeFileSync(b, 'corrupt'); fs.unlinkSync(c);
    const failed = f.recover();
    assert.equal(failed.summary.failed, 3); assert.equal(failed.task.restoreFailed, 3);
    assert.match(report(failed).files[0].message, /已被修改/);
    assert.equal(fs.readFileSync(a, 'utf8'), 'user edit');
    assert.equal(f.recover().summary.total, 0);
    fs.writeFileSync(a, compressed); fs.writeFileSync(b, f.originals.get(path.join('二级', 'b.pack'))); fs.writeFileSync(c, f.originals.get(path.join('二级', 'c.pack')));
    const done = f.recover('restore-retry'); assert.equal(done.summary.restored, 3); assert.equal(done.task.restoreFailed, 0); verify(f);
});

test('missing targets and directories are recreated, while already-original files are not rewritten', t => {
    const f = fixture(t), a = path.join(f.source, '二级/a.pack');
    fs.writeFileSync(a, f.originals.get(path.join('二级', 'a.pack')));
    const stamp = fs.statSync(a).mtimeMs;
    fs.unlinkSync(path.join(f.source, '二级/b.pack'));
    const done = f.recover(); assert.equal(done.summary.skipped, 1); assert.equal(done.summary.restored, 2);
    assert.equal(fs.statSync(a).mtimeMs, stamp); verify(f);
    const g = fixture(t);
    const moved = path.join(g.root, 'moved-originals'); fs.renameSync(g.source, moved);
    assert.equal(g.recover().summary.restored, 3); verify(g);
});

test('an interrupted compression commit with no result can be restored directly', t => {
    const f = fixture(t), journal = path.join(path.dirname(f.taskFile), 'events.jsonl');
    const lines = fs.readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse).filter(event => event.type !== 'result');
    fs.writeFileSync(journal, lines.map(JSON.stringify).join('\n') + '\n');
    assert.equal(f.tasks.loadTask(f.taskFile).info().pending, 3);
    const done = f.recover(); assert.equal(done.summary.restored, 3); verify(f);
    assert.match(f.recover('resume').error, /不能继续压缩/);
});

test('checkpoint failure after replacing a file resumes by detecting original bytes, without another replacement', t => {
    const f = fixture(t), load = f.tasks.loadTask;
    f.tasks.loadTask = (...args) => {
        const task = load(...args), append = task.append;
        task.append = event => { if (event.type === 'restore-result') throw new Error('restore journal full'); append(event); };
        return task;
    };
    const failed = f.recover(); f.tasks.loadTask = load;
    assert.match(failed.error, /restore journal full/); assert.equal(failed.task.restoreStarted, true);
    const a = path.join(f.source, '二级/a.pack'), stamp = fs.statSync(a).mtimeMs;
    const done = f.recover(); assert.equal(done.summary.skipped, 1); assert.equal(done.summary.restored, 2);
    assert.equal(fs.statSync(a).mtimeMs, stamp); verify(f);
});

test('checkpoint failure before restoration leaves compressed files untouched and resumable', t => {
    const f = fixture(t), load = f.tasks.loadTask, before = fs.readFileSync(path.join(f.source, '二级/a.pack'));
    f.tasks.loadTask = (...args) => {
        const task = load(...args), append = task.append;
        task.append = event => { if (event.type === 'restore-start') throw new Error('cannot journal start'); append(event); }; return task;
    };
    const failed = f.recover(); f.tasks.loadTask = load;
    assert.match(failed.error, /cannot journal start/); assert.equal(failed.task.restoreStarted, false);
    assert.deepEqual(fs.readFileSync(path.join(f.source, '二级/a.pack')), before);
    assert.equal(f.recover().summary.restored, 3);
});

test('restoration respects the compression task lock', t => {
    const f = fixture(t), task = f.tasks.loadTask(f.taskFile), unlock = task.lock();
    try { assert.match(f.recover().error, /正在运行/); }
    finally { unlock(); }
    assert.equal(f.recover().summary.restored, 3);
});

test('restoration works with all compressors removed in a fresh process', t => {
    const f = fixture(t);
    fs.renameSync(path.join(f.tool, 'resCompress/compressors'), path.join(f.tool, 'resCompress/disabled-compressors'));
    const result = spawnSync(process.execPath, [path.join(f.tool, 'resCompress/batch.js'), '--restore', f.taskFile], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(JSON.parse(result.stdout).summary.restored, 3); verify(f);
});

test('junctions in either source or backup are refused without touching redirected files', { skip: process.platform !== 'win32' }, t => {
    for (const location of ['source', 'backup']) {
        const f = fixture(t), inside = path.join(f[location], '二级'), moved = path.join(f.root, 'outside');
        fs.renameSync(inside, moved); fs.symlinkSync(moved, inside, 'junction');
        const before = fs.readFileSync(path.join(moved, 'a.pack'));
        const failed = f.recover(); assert.equal(failed.summary.failed, 3);
        assert.deepEqual(fs.readFileSync(path.join(moved, 'a.pack')), before);
        assert.match(report(failed).files[0].message, /链接|联接/);
    }
});

test('target changes during a temporary write are detected and temporary files are removed', t => {
    const f = fixture(t), a = path.join(f.source, '二级/a.pack'), write = fs.writeFileSync;
    let pending = true;
    fs.writeFileSync = function(filename, data, ...args) {
        const result = write.call(this, filename, data, ...args);
        if (pending && typeof filename === 'number' && Buffer.isBuffer(data) && data.equals(f.originals.get(path.join('二级', 'a.pack')))) {
            pending = false; write(a, 'changed during restore');
        }
        return result;
    };
    let failed;
    try { failed = f.recover(); } finally { fs.writeFileSync = write; }
    assert.equal(failed.summary.failed, 1); assert.equal(failed.summary.restored, 2);
    assert.equal(fs.readFileSync(a, 'utf8'), 'changed during restore');
    assert.equal(fs.readdirSync(path.dirname(a)).some(name => name.startsWith('.resource-restore-')), false);
});

test('old backup export preserves all file types and structure; conflicts and repeated exports never overwrite', t => {
    const f = fixture(t), output = path.join(f.root, '导出');
    fs.writeFileSync(path.join(f.backup, 'notes.txt'), 'legacy data');
    fs.mkdirSync(path.join(output, '二级'), { recursive: true }); fs.writeFileSync(path.join(output, '二级/a.pack'), 'keep');
    const first = f.run({ mode: 'restore-export', backupDir: f.backup, outputDir: output });
    assert.equal(first.summary.restored, 3); assert.equal(first.summary.failed, 1);
    assert.equal(fs.readFileSync(path.join(output, 'notes.txt'), 'utf8'), 'legacy data');
    assert.equal(fs.readFileSync(path.join(output, '二级/a.pack'), 'utf8'), 'keep');
    fs.unlinkSync(path.join(output, '二级/a.pack'));
    const second = f.run({ mode: 'restore-export', backupDir: f.backup, outputDir: output });
    assert.equal(second.summary.restored, 1); assert.equal(second.summary.skipped, 3);
    for (const [relative, data] of f.originals) assert.deepEqual(fs.readFileSync(path.join(output, relative)), data);
    assert.equal(f.tasks.loadTask(f.taskFile).info().restoreStarted, false);
});

test('export can cancel during scan or copy and resume by skipping matching files', t => {
    const f = fixture(t), output = path.join(f.root, 'export'); let cancel = false;
    const scan = f.restore.exportBackup(f.backup, output, { shouldCancel: () => cancel, onProgress: () => { cancel = true; } });
    assert.equal(scan.cancelled, true); assert.equal(fs.existsSync(output), false);
    cancel = false;
    const partial = f.restore.exportBackup(f.backup, output, { shouldCancel: () => cancel, onFile: () => { cancel = true; } });
    assert.equal(partial.restored, 1); assert.equal(partial.cancelled, true);
    const done = f.restore.exportBackup(f.backup, output); assert.equal(done.restored, 2); assert.equal(done.skipped, 1);
});

test('export supports filesystems without hard links and preserves a competing new destination', t => {
    const f = fixture(t), output = path.join(f.root, 'portable-export'), link = fs.linkSync;
    fs.linkSync = (temporary, target) => {
        if (path.basename(target) === 'b.pack') fs.writeFileSync(target, 'competing file');
        const error = new Error('no hard links'); error.code = 'ENOTSUP'; throw error;
    };
    let result;
    try { result = f.restore.exportBackup(f.backup, output); } finally { fs.linkSync = link; }
    assert.equal(result.restored, 2); assert.equal(result.failed, 1);
    assert.equal(fs.readFileSync(path.join(output, '二级/b.pack'), 'utf8'), 'competing file');
    assert.deepEqual(fs.readFileSync(path.join(output, '二级/a.pack')), f.originals.get(path.join('二级', 'a.pack')));
    assert.equal(fs.readdirSync(path.join(output, '二级')).some(name => name.startsWith('.resource-restore-')), false);
});

test('export refuses overlapping directories and links; task without backups has no restore action', { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t);
    for (const output of [f.backup, path.join(f.backup, 'inside'), f.root]) assert.throws(() => f.restore.exportBackup(f.backup, output), /互相包含/);
    const empty = path.join(f.root, 'outside'); fs.mkdirSync(empty); fs.writeFileSync(path.join(empty, 'untouched'), 'safe');
    fs.symlinkSync(empty, path.join(f.backup, 'linked'), 'junction');
    const output = path.join(f.root, 'export');
    assert.equal(f.restore.exportBackup(f.backup, output).failed, 1); assert.equal(fs.existsSync(path.join(output, 'linked')), false);
    const first = f.run({ mode: 'compress', folder: f.source, options: { fixtureEnabled: false } });
    assert.equal(first.task.canRestore, false);
    assert.match(f.run({ mode: 'restore', taskFile: first.task.taskFile }).error, /没有可恢复/);
});

test('real PNG, JPEG and MP3 compression backups restore byte-for-byte without invoking encoders again', { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t), source = path.join(f.root, '真实 图片音乐'); fs.mkdirSync(source);
    const script = `param($Source)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$bitmap=New-Object Drawing.Bitmap 256,256
$random=New-Object Random 42
try {
    for ($x=0; $x -lt 256; $x++) { for ($y=0; $y -lt 256; $y++) {
        $shade=$random.Next(16)*16
        $bitmap.SetPixel($x,$y,[Drawing.Color]::FromArgb($shade,$shade,255-$shade))
    } }
    $bitmap.Save((Join-Path $Source '测试.png'),[Drawing.Imaging.ImageFormat]::Png)
    $codec=[Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $parameters=New-Object Drawing.Imaging.EncoderParameters 1
    $parameters.Param[0]=New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality),([long]100)
    try { $bitmap.Save((Join-Path $Source '测试.jpg'),$codec,$parameters) } finally { $parameters.Dispose() }
} finally { $bitmap.Dispose() }
`;
    const driver = path.join(f.root, 'images.ps1'); fs.writeFileSync(driver, '\uFEFF' + script);
    const imageResult = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', driver, source], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(imageResult.status, 0, imageResult.stdout + imageResult.stderr);
    const rate = 44100, samples = rate * 2, wav = Buffer.alloc(44 + samples * 4);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32);
    wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 4, 40);
    for (let index = 0; index < samples; index++) {
        const value = Math.round(Math.sin(index * 2 * Math.PI * 440 / rate) * 16000);
        wav.writeInt16LE(value, 44 + index * 4); wav.writeInt16LE(-value, 46 + index * 4);
    }
    const input = path.join(f.root, 'input.wav'); fs.writeFileSync(input, wav);
    const music = path.join(source, '主题.mp3');
    const audioResult = spawnSync(path.join(f.tool, 'resCompress/compressors/mp3/lame.exe'), ['-b', '192', input, music], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
    assert.equal(audioResult.status, 0, audioResult.stderr);
    const originals = fs.readdirSync(source).map(name => [name, fs.readFileSync(path.join(source, name))]);
    const compressed = f.run({ mode: 'compress', folder: source, backupDir: path.join(f.root, 'real-backup'), options: { mp3Enabled: true } });
    assert.equal(compressed.summary.compressed, 3, JSON.stringify(report(compressed)));
    const done = f.run({ mode: 'restore', taskFile: compressed.task.taskFile });
    assert.equal(done.summary.restored, 3, JSON.stringify(report(done)));
    for (const [name, data] of originals) assert.deepEqual(fs.readFileSync(path.join(source, name)), data);
});
