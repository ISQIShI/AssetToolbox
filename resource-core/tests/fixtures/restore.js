const { compressionPipeline, engineFor, batchFor, installType, cliJob, cliCommand } = require('../helpers');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { copyTool } = require('../portable');

function fixture(t) {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'backup-restore-test-'));
    t.after(() => {
        assert.equal(path.dirname(fs.realpathSync(root)), parent);
        assert.ok(path.basename(root).startsWith('backup-restore-test-'));
        fs.rmSync(root, { recursive: true, force: true });
    });
    const tool = copyTool(root), module = path.join(tool, 'resource-core/providers/fixture');
    fs.mkdirSync(module); installType(tool, 'fixture');
    fs.writeFileSync(path.join(module, 'config.js'), 'module.exports=' + JSON.stringify({ displayName: '恢复测试', extensions: ['.pack'], enabledKey: 'fixtureEnabled', defaults: {} }));
    fs.writeFileSync(path.join(module, 'index.js'), `const fs=require('node:fs');module.exports={apiVersion:2,version:'1.0.0',displayName:'测试提供方',adapters:{'compress':{version:'1.0.0',resourceTypes:['fixture'],schema:require('./config'),execute({input,output}){fs.writeFileSync(output,fs.readFileSync(input).subarray(0,10));return {output};}}}};`);
    const source = path.join(root, '原始 素材'), backupDir = path.join(root, '备份');
    fs.mkdirSync(path.join(source, '二级'), { recursive: true });
    const originals = new Map();
    for (const name of ['a', 'b', 'c']) {
        const relative = path.join('二级', name + '.pack'), data = Buffer.from('PACK:' + name.repeat(200));
        fs.writeFileSync(path.join(source, relative), data); originals.set(relative, data);
    }
    const batch = batchFor(path.join(tool, 'resource-core')), tasks = require(path.join(tool, 'resource-core/tasks'));
    const restore = require(path.join(tool, 'resource-core/restore'));
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
    const first = run({ mode: 'process', folder: source, backupDir });
    assert.equal(first.exitCode, 0, first.error); assert.equal(first.summary.backedUp, 3);
    const taskFile = first.task.taskFile, backup = tasks.loadTask(taskFile).header.backupSession;
    const recover = (mode = 'restore', cancelAfter = Infinity) => run({ mode, taskFile }, cancelAfter);
    return { root, tool, source, backup, originals, run, recover, taskFile, tasks, restore };
}
module.exports = { fixture };
