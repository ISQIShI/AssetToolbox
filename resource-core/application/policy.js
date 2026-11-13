const fs = require('node:fs');
const path = require('node:path');

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function record(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('INVALID_REQUEST', '请求包含未知字段或不是对象');
}
function within(root, target) {
    const relative = path.relative(root, target);
    return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
function canonical(value) {
    if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value) || (process.platform === 'win32' && /[:]/.test(value.slice(2)))) fail('INVALID_REQUEST', '目录必须是绝对路径，不允许控制字符或备用数据流');
    let current = path.resolve(value);
    const suffix = [];
    while (!fs.existsSync(current)) {
        // 不把悬空链接当作可以创建的目录。
        try { if (fs.lstatSync(current).isSymbolicLink()) fail('PATH_FORBIDDEN', '路径包含损坏链接'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const parent = path.dirname(current);
        if (parent === current) fail('PATH_FORBIDDEN', '路径没有可用根目录');
        suffix.unshift(path.basename(current)); current = parent;
    }
    if (!fs.statSync(current).isDirectory()) fail('INVALID_REQUEST', '路径不是目录');
    return path.join(fs.realpathSync(current), ...suffix);
}
function loadPolicy(filename) {
    const input = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
    return normalizePolicy(input);
}
function normalizePolicy(input) {
    record(input, ['schema', 'sourceRoots', 'outputRoots', 'backupRoots', 'allowOverwrite', 'allowRestore', 'allowDependencyInstall', 'allowServiceManagement']);
    if (input.schema !== 'asset-toolbox.automation-policy/2') fail('UNSUPPORTED_VERSION', '自动化权限配置版本不支持');
    const policy = { schema: input.schema };
    for (const key of ['sourceRoots', 'outputRoots', 'backupRoots']) {
        if (!Array.isArray(input[key]) || input[key].length > 32) fail('INVALID_REQUEST', key + ' 必须为最多 32 项的数组');
        policy[key] = input[key].map(canonical).sort();
    }
    for (const key of ['allowOverwrite', 'allowRestore', 'allowDependencyInstall', 'allowServiceManagement']) {
        if (input[key] !== undefined && typeof input[key] !== 'boolean') fail('INVALID_REQUEST', key + ' 必须为布尔值');
        policy[key] = input[key] === true;
    }
    return policy;
}
function checkPath(value, roots) {
    const target = canonical(value);
    // 权限根在启动时固定真实位置；若之后被替换为链接则拒绝。
    if (!roots.some(root => canonical(root) === root && within(root, target))) fail('PATH_FORBIDDEN', '目录超出启动配置允许的范围');
    const core = fs.realpathSync(path.join(__dirname, '..'));
    if (within(core, target) || within(target, core)) fail('PATH_FORBIDDEN', '自动化素材目录不能包含核心代码、配置或任务存储');
    return target;
}
function authorize(request, policy) {
    if (request.mode === 'dependency-install') {
        if (!policy.allowDependencyInstall) fail('PERMISSION_DENIED', '启动配置未允许安装依赖');
        return request;
    }
    if (request.mode.startsWith('restore-export')) {
        if (!policy.allowRestore) fail('PERMISSION_DENIED', '启动配置未允许恢复或导出备份');
        checkPath(request.backupDir, policy.backupRoots);
        checkPath(request.outputDir, policy.outputRoots);
        return request;
    }
    let source = request.folder, output = request.outputDir, backup = request.backupDir;
    if (request.taskFile) {
        const header = require('../tasks').loadTask(request.taskFile).header;
        source = header.source; output = header.outputDir; backup = header.backupDir;
    }
    checkPath(source, policy.sourceRoots);
    if (output) checkPath(output, policy.outputRoots);
    if (backup) checkPath(backup, policy.backupRoots);
    if (request.mode.startsWith('restore')) {
        if (!policy.allowRestore) fail('PERMISSION_DENIED', '启动配置未允许恢复原文件');
    } else {
        const pipeline = request.taskFile ? require('../tasks').loadTask(request.taskFile).header.pipeline : request.pipeline;
        const enabled = pipeline.filter(step => step.enabled);
        const operations = require('../framework/registry').operations;
        const observation = enabled.length > 0 && enabled.every(step => operations.get(step.operation)?.resultPolicy === 'observe');
        if (!observation && !output && (!policy.allowOverwrite || !backup)) fail('PERMISSION_DENIED', '转换默认另存；覆盖必须由启动配置授权并提供备份目录');
    }
    return request;
}
module.exports = { fail, record, within, canonical, loadPolicy, normalizePolicy, checkPath, authorize };
