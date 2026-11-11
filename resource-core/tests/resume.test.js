const { compressionPipeline, engineFor, batchFor, installType, cliJob, cliCommand } = require('./helpers');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync, spawn } = require('node:child_process');
const { copyTool } = require('./portable');

function fixture(t, names = ['a', 'b', 'c']) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'compress-resume-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(root)), parent);
        assert.ok(path.basename(root).startsWith('compress-resume-test-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const tool = copyTool(root), module = path.join(tool, 'resource-core/providers/fixture');
    fs.mkdirSync(module); installType(tool, 'fixture');
    fs.writeFileSync(path.join(module, 'config.js'), 'module.exports = ' + JSON.stringify({ displayName: '测试续压', extensions: ['.pack'], enabledKey: 'fixtureEnabled', defaults: {} }));
    fs.writeFileSync(path.join(module, 'index.js'), `const fs=require('node:fs'),path=require('node:path'); module.exports={apiVersion:2,version:'1.0.0',displayName:'测试提供方',adapters:{'compress':{version:'1.0.0',resourceTypes:['fixture'],schema:require('./config'),
        execute({input,output}) {
            const data=fs.readFileSync(input);
            fs.appendFileSync(path.join(__dirname,'calls.txt'), data.toString()+'\\n');
            if(data.toString().includes('KEEP')) return {skipped:true};
            fs.writeFileSync(output,data.subarray(0,data.length-1)); return {output};
        }
    }}};`);
    const source = path.join(root, '原始 资源'); fs.mkdirSync(path.join(source, '子目录'), { recursive: true });
    const originals = new Map();
    for (const name of names) {
        const relative = path.join('子目录', name + '.pack'), data = Buffer.from('PACK:' + name + 'x'.repeat(100));
        originals.set(relative, data); fs.writeFileSync(path.join(source, relative), data);
    }
    const core = engineFor(path.join(tool, 'resource-core')), batch = batchFor(path.join(tool, 'resource-core')), tasks = require(path.join(tool, 'resource-core/tasks'));
    const calls = () => fs.existsSync(path.join(module, 'calls.txt')) ? fs.readFileSync(path.join(module, 'calls.txt'), 'utf8').trim().split('\n') : [];
    const run = (request, cancelAfter = Infinity) => {
        const job = fs.mkdtempSync(path.join(root, 'job-')), compress = core.processFolder;
        let count = 0;
        core.processFolder = (folder, options) => compress(folder, { ...options, onFile: file => {
            options.onFile(file); if (++count === cancelAfter) fs.writeFileSync(path.join(job, 'cancel'), '');
        } });
        try { return batch.runJob(request, job, path.join(root, 'reports')); }
        finally { core.processFolder = compress; }
    };
    return { root, tool, source, module, originals, core, batch, tasks, calls, run };
}
const resume = taskFile => ({ mode: 'resume', taskFile });
const retry = taskFile => ({ mode: 'retry', taskFile });
function report(state) { return JSON.parse(fs.readFileSync(path.join(state.reportDirectory, 'report.json'))); }

test('cancel, restart, resume, and resume again never re-encode completed files or newly added resources', t => {
    const f = fixture(t), first = f.run({ mode: 'process', folder: f.source }, 1);
    assert.equal(first.exitCode, 2); assert.equal(first.task.pending, 2); assert.equal(first.task.completed, 1);
    const firstFile = path.join(f.source, '子目录/a.pack'), processed = fs.readFileSync(firstFile);
    fs.writeFileSync(path.join(f.source, 'new.pack'), 'PACK:new');
    const second = f.run(resume(first.task.taskFile));
    assert.equal(second.summary.processed, 2); assert.equal(second.task.pending, 0); assert.equal(second.task.completed, 3);
    assert.deepEqual(fs.readFileSync(firstFile), processed); assert.equal(f.calls().length, 3);
    assert.equal(fs.readFileSync(path.join(f.source, 'new.pack'), 'utf8'), 'PACK:new');
    const third = f.run(resume(first.task.taskFile));
    assert.equal(third.summary.total, 0); assert.equal(f.calls().length, 3);
    const command = spawnSync(process.execPath, cliJob(f.tool, { mode: 'resume', taskId: first.task.id }), { encoding: 'utf8', windowsHide: true });
    assert.equal(command.status, 0, command.stderr); assert.equal(JSON.parse(command.stdout).result.state.summary.total, 0); assert.equal(f.calls().length, 3);
});

test('pending and failed queues stay independent; successful skipped files are not retried', t => {
    const f = fixture(t, ['a', 'b', 'c', 'd', 'e']);
    fs.writeFileSync(path.join(f.source, '子目录/b.pack'), 'PACK:KEEP');
    fs.writeFileSync(path.join(f.source, '子目录/c.pack'), 'broken');
    const first = f.run({ mode: 'process', folder: f.source }, 3);
    assert.equal(first.task.completed, 2); assert.equal(first.task.failed, 1); assert.equal(first.task.pending, 2);
    fs.writeFileSync(path.join(f.source, '子目录/c.pack'), 'PACK:repairedxxxx');
    const second = f.run(retry(first.task.taskFile));
    assert.equal(second.summary.total, 1); assert.equal(second.task.failed, 0); assert.equal(second.task.pending, 2);
    const third = f.run(resume(first.task.taskFile));
    assert.equal(third.summary.total, 2); assert.equal(third.task.completed, 5); assert.equal(f.calls().length, 5);
    assert.equal(f.calls().filter(call => call.includes('KEEP')).length, 1);
});

test('save-as retry replaces only its unchanged failure copy and preserves successful outputs and source bytes', t => {
    const f = fixture(t), output = path.join(f.root, '输出');
    fs.writeFileSync(path.join(f.source, '子目录/b.pack'), 'broken');
    const first = f.run({ mode: 'process', folder: f.source, outputDir: output });
    assert.equal(first.task.failed, 1); assert.equal(first.task.completed, 2);
    const a = fs.readFileSync(path.join(output, '子目录/a.pack'));
    const repaired = 'PACK:repaired' + 'x'.repeat(30); fs.writeFileSync(path.join(f.source, '子目录/b.pack'), repaired);
    const second = f.run({ ...retry(first.task.taskFile), options: { fixtureEnabled: false }, outputDir: path.join(f.root, 'wrong') });
    assert.equal(second.summary.processed, 1); assert.equal(second.task.failed, 0);
    assert.equal(fs.readFileSync(path.join(output, '子目录/b.pack'), 'utf8'), repaired.slice(0, -1));
    assert.equal(fs.readFileSync(path.join(f.source, '子目录/b.pack'), 'utf8'), repaired);
    assert.deepEqual(fs.readFileSync(path.join(output, '子目录/a.pack')), a);
    assert.equal(fs.existsSync(path.join(f.root, 'wrong')), false); assert.equal(f.calls().length, 3);
    assert.equal(report(second).task.completed, 3);
});

test('retry refuses changed failure copies and unrelated existing outputs; can recover after conflicts are removed', t => {
    const f = fixture(t), output = path.join(f.root, '输出');
    fs.mkdirSync(path.join(output, '子目录'), { recursive: true });
    fs.writeFileSync(path.join(output, '子目录/a.pack'), 'unrelated');
    fs.writeFileSync(path.join(f.source, '子目录/b.pack'), 'broken');
    const first = f.run({ mode: 'process', folder: f.source, outputDir: output });
    fs.writeFileSync(path.join(f.source, '子目录/b.pack'), 'PACK:fixedxxxx');
    fs.writeFileSync(path.join(output, '子目录/b.pack'), 'edited fallback');
    const blocked = f.run(retry(first.task.taskFile));
    assert.equal(blocked.task.failed, 2);
    assert.equal(fs.readFileSync(path.join(output, '子目录/a.pack'), 'utf8'), 'unrelated');
    assert.equal(fs.readFileSync(path.join(output, '子目录/b.pack'), 'utf8'), 'edited fallback');
    fs.unlinkSync(path.join(output, '子目录/a.pack')); fs.unlinkSync(path.join(output, '子目录/b.pack'));
    const done = f.run(retry(first.task.taskFile));
    assert.equal(done.task.failed, 0); assert.equal(done.task.completed, 3);
});

test('overwrite resume reuses the task backup directory without replacing any earlier backup', t => {
    const f = fixture(t), backupDir = path.join(f.root, '备份');
    const first = f.run({ mode: 'process', folder: f.source, backupDir }, 1);
    const second = f.run(resume(first.task.taskFile));
    assert.equal(first.summary.backupDirectory, second.summary.backupDirectory);
    assert.equal(fs.readdirSync(backupDir).length, 1);
    for (const [relative, bytes] of f.originals) assert.deepEqual(fs.readFileSync(path.join(first.summary.backupDirectory, relative)), bytes);
    assert.equal(f.calls().length, 3);
});

test('changed pending files fail safely until explicitly retried; changed successful files remain excluded', t => {
    const f = fixture(t), first = f.run({ mode: 'process', folder: f.source }, 1);
    const a = path.join(f.source, '子目录/a.pack'), b = path.join(f.source, '子目录/b.pack');
    fs.writeFileSync(a, 'PACK:changed-success'); fs.writeFileSync(b, 'PACK:changed-pending');
    const second = f.run(resume(first.task.taskFile));
    assert.equal(second.task.failed, 1); assert.equal(second.summary.processed, 1);
    assert.equal(fs.readFileSync(b, 'utf8'), 'PACK:changed-pending');
    assert.match(report(second).files.find(file => file.path.endsWith('b.pack')).message, /发生变化/);
    const third = f.run(retry(first.task.taskFile));
    assert.equal(third.summary.processed, 1); assert.equal(third.task.failed, 0);
    assert.equal(fs.readFileSync(a, 'utf8'), 'PACK:changed-success'); assert.equal(f.calls().length, 3);
});

test('incomplete scan resumes scanning; complete plan excludes new files and tolerates cancelled retries', t => {
    const f = fixture(t), job = fs.mkdtempSync(path.join(f.root, 'job-'));
    fs.writeFileSync(path.join(job, 'cancel'), '');
    const first = f.batch.runJob({ mode: 'process', folder: f.source }, job, path.join(f.root, 'reports'));
    assert.equal(first.task.scanComplete, false); assert.equal(first.task.canResume, true); assert.equal(f.calls().length, 0);
    fs.writeFileSync(path.join(f.source, '子目录/a.pack'), 'broken');
    const second = f.run(resume(first.task.taskFile));
    assert.equal(second.task.failed, 1); assert.equal(second.task.completed, 2);
    const retryJob = fs.mkdtempSync(path.join(f.root, 'job-')); fs.writeFileSync(path.join(retryJob, 'cancel'), '');
    const cancelled = f.batch.runJob(retry(first.task.taskFile), retryJob, path.join(f.root, 'reports'));
    assert.equal(cancelled.cancelled, true); assert.equal(cancelled.task.failed, 1); assert.equal(cancelled.processed, 0);
});

test('write-ahead recovery recognizes already committed output after final checkpoint write fails', t => {
    for (const mode of ['overwrite', 'saveAs', 'backup']) {
        const f = fixture(t), create = f.tasks.createTask;
        let once = true;
        f.tasks.createTask = (...args) => {
            const task = create(...args), finish = task.finish;
            task.finish = record => { if (once) { once = false; throw new Error('simulated interruption after commit'); } finish(record); };
            return task;
        };
        const options = mode === 'saveAs' ? { outputDir: path.join(f.root, 'output') } : mode === 'backup' ? { backupDir: path.join(f.root, 'backup') } : {};
        const first = f.run({ mode: 'process', folder: f.source, ...options });
        f.tasks.createTask = create;
        assert.equal(first.exitCode, 1); assert.equal(f.calls().length, 1);
        const second = f.run(resume(first.task.taskFile));
        assert.equal(second.task.completed, 3, second.error); assert.equal(second.task.failed, 0); assert.equal(second.summary.total, 2);
        assert.equal(f.calls().length, 3, mode + ' must not recompress committed first file');
    }
});

test('task locking refuses concurrent execution and refreshes stale in-memory state after acquiring lock', t => {
    const f = fixture(t), first = f.run({ mode: 'process', folder: f.source }, 1);
    const stale = f.tasks.loadTask(first.task.taskFile), owner = f.tasks.loadTask(first.task.taskFile), unlock = owner.lock();
    try {
        const blocked = f.run(resume(first.task.taskFile));
        assert.match(blocked.error, /正在运行/); assert.equal(f.calls().length, 1);
    } finally { unlock(); }
    const second = f.run(resume(first.task.taskFile)); assert.equal(second.task.completed, 3);
    const unlockStale = stale.lock();
    try { assert.equal(stale.info().completed, 3); } finally { unlockStale(); }
    assert.equal(f.tasks.loadTask(first.task.taskFile).info().completed, 3);
});

test('two processes recovering a stale lock cannot process the same pending file twice', async t => {
    const f = fixture(t), first = f.run({ mode: 'process', folder: f.source }, 1);
    const ended = spawnSync(process.execPath, ['-e', ''], { windowsHide: true });
    assert.equal(ended.status, 0);
    fs.writeFileSync(path.join(path.dirname(first.task.taskFile), 'task.lock'), JSON.stringify({ pid: ended.pid, token: 'stale' }));
    // 延长文件处理，使并发恢复真正重叠。
    const implementation = path.join(f.module, 'index.js');
    fs.writeFileSync(implementation, fs.readFileSync(implementation, 'utf8').replace('const data=fs.readFileSync(input);', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200); const data=fs.readFileSync(input);'));
    const launch = () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, cliJob(f.tool, { mode: 'resume', taskId: first.task.id }), { windowsHide: true, stdio: 'ignore' });
        child.on('error', reject); child.on('exit', resolve);
    });
    const statuses = await Promise.all([launch(), launch()]);
    assert.ok(statuses.every(status => status === 0 || status === 1));
    const final = f.run(resume(first.task.taskFile));
    assert.equal(final.task.completed, 3); assert.equal(final.task.failed, 0); assert.equal(f.calls().length, 3);
});

test('committed file stays completed even if its backup disappears before recovery', t => {
    const f = fixture(t), create = f.tasks.createTask;
    f.tasks.createTask = (...args) => {
        const task = create(...args);
        task.finish = () => { throw new Error('simulated post-commit interruption'); };
        return task;
    };
    const first = f.run({ mode: 'process', folder: f.source, backupDir: path.join(f.root, 'backup') });
    f.tasks.createTask = create;
    const loaded = f.tasks.loadTask(first.task.taskFile);
    fs.unlinkSync(path.join(loaded.header.backupSession, '子目录/a.pack'));
    const next = f.run(resume(first.task.taskFile));
    assert.equal(next.task.completed, 3); assert.equal(next.task.failed, 0); assert.equal(f.calls().length, 3);
    assert.equal(next.recoveryWarnings.length, 1); assert.match(next.recoveryWarnings[0], /不会重复处理/);
});

test('checkpoint write failure before commit stops the batch without changing source bytes', t => {
    const f = fixture(t), create = f.tasks.createTask;
    f.tasks.createTask = (...args) => {
        const task = create(...args), append = task.append;
        task.append = event => { if (event.type !== 'plan') throw new Error('checkpoint disk full'); append(event); };
        return task;
    };
    const failed = f.run({ mode: 'process', folder: f.source }); f.tasks.createTask = create;
    assert.equal(failed.exitCode, 1); assert.match(failed.error, /checkpoint disk full/);
    for (const [relative, bytes] of f.originals) assert.deepEqual(fs.readFileSync(path.join(f.source, relative)), bytes);
    assert.equal(failed.task.pending, 3);
    const done = f.run(resume(failed.task.taskFile)); assert.equal(done.task.completed, 3);
});

test('truncated journal tail is repaired, malformed complete records and traversal paths are rejected', t => {
    const f = fixture(t), first = f.run({ mode: 'process', folder: f.source }, 1);
    const journal = path.join(path.dirname(first.task.taskFile), 'events.jsonl');
    fs.appendFileSync(journal, '{"type":"res');
    const second = f.run(resume(first.task.taskFile)); assert.equal(second.task.completed, 3);
    fs.appendFileSync(journal, '{bad record}\n');
    assert.throws(() => f.tasks.loadTask(first.task.taskFile));
    const protectedBytes = fs.readFileSync(path.join(f.source, '子目录/a.pack'));
    const failed = f.run(resume(first.task.taskFile)); assert.equal(failed.exitCode, 1);
    assert.deepEqual(fs.readFileSync(path.join(f.source, '子目录/a.pack')), protectedBytes);
    assert.throws(() => f.core.processFolder(f.source, { fileList: ['../outside.pack'] }), /路径无效/);
    assert.throws(() => f.core.processFolder(f.source, { fileList: [path.join(f.root, 'outside.pack')] }), /路径无效/);
});

test('resume refuses a pending parent changed into a junction and never touches external files', { skip: process.platform !== 'win32' }, t => {
    const f = fixture(t), first = f.run({ mode: 'process', folder: f.source }, 1);
    const originalDirectory = path.join(f.source, '子目录'), moved = path.join(f.root, 'outside');
    assert.equal(path.dirname(originalDirectory), f.source); assert.equal(path.dirname(moved), f.root);
    fs.renameSync(originalDirectory, moved); fs.symlinkSync(moved, originalDirectory, 'junction');
    const before = fs.readFileSync(path.join(moved, 'b.pack'));
    const second = f.run(resume(first.task.taskFile));
    assert.equal(second.task.failed, 2); assert.equal(f.calls().length, 1);
    assert.deepEqual(fs.readFileSync(path.join(moved, 'b.pack')), before);
});

