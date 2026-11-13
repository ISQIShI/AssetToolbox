const fs = require('node:fs');
const path = require('node:path');
const { acquire, acquireShared, alive } = require('./lock');
const { plan, validate } = require('./resources');
const { JOB } = require('./contract');
const { fail } = require('./policy');

function enter(request, directory) {
    const filename = path.join(directory, 'job.json');
    // 底层隔离测试/内部直接执行仍使用独占屏障，不能绕过已有共享作业。
    if (!fs.existsSync(filename)) return acquire();
    const meta = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const claim = JSON.parse(fs.readFileSync(path.join(directory, 'dispatch.json'), 'utf8'));
    const root = path.join(__dirname, '..', 'data', 'jobs', 'v5');
    if (meta.schema !== JOB || !/^[a-f0-9]{64}$/.test(meta.id) || path.resolve(directory) !== path.join(root, meta.id) ||
        claim.schema !== 'asset-toolbox.dispatch/3' || claim.owner !== meta.owner || claim.sequence !== meta.sequence ||
        process.ppid !== meta.ownerPid || !alive(meta.ownerPid)) fail('UNSUPPORTED_VERSION', '工作进程缺少有效的调度声明');
    validate(meta.resources);
    if (!Number.isInteger(claim.slot) || claim.slot < 1 || claim.slot > require('./scheduling').MAX) fail('UNSUPPORTED_VERSION', '启动槽位声明无效');
    if (JSON.stringify(plan(request)) !== JSON.stringify(meta.resources)) fail('INVALID_REQUEST', '启动时资源范围已改变');
    return acquireShared(meta.resources, meta.id, claim.slot, true);
}
module.exports = { enter };
