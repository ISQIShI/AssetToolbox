const fs = require('node:fs');
const path = require('node:path');
const catalog = require('./catalog.json');
const { safePath, hash, inventory } = require('./paths');
const CORE = path.resolve(__dirname, '../..');
const fingerprint = plan => hash(Buffer.from(JSON.stringify(plan)));
function active(id, root = CORE) {
    if (!catalog.providers[id]?.artifacts) return null;
    const base = safePath(root, `data/dependencies/${id}`), filename = safePath(base, 'active.json');
    if (!fs.existsSync(filename)) return null;
    const record = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (record.schema !== 1 || record.id !== id || !/^[a-f0-9-]{36}$/.test(record.directory) || !/^\d+\.\d+(?:\.\d+)?$/.test(record.version) || !record.files || typeof record.files !== 'object') throw new Error('安装记录无效，请重新安装依赖');
    const directory = safePath(base, 'installs/' + record.directory);
    const actual = inventory(directory), expected = record.files;
    if (Object.keys(actual).length !== Object.keys(expected).length || Object.entries(expected).some(([name, digest]) => actual[name] !== digest)) throw new Error('已安装依赖的完整性校验失败，请修复安装');
    return { ...record, directory };
}
function runtimeDirectory(provider) {
    const root = path.resolve(provider.directory, '../..');
    const record = active(provider.id, root);
    if (record && record.version !== catalog.providers[provider.id].version) throw new Error('已安装版本与当前提供方不匹配，请更新到核验版本');
    return record?.directory || provider.directory;
}
function sharpModule(root = CORE) {
    const record = active('sharp', root);
    if (record && record.version !== catalog.providers.sharp.version) throw new Error('Sharp 版本与当前提供方不匹配，请更新到核验版本');
    return record ? path.join(record.directory, 'node_modules/sharp') : path.join(root, 'node_modules/sharp');
}
function newer(left, right) {
    const a = left.split('.').map(Number), b = right.split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0); }
    return false;
}
function management(id, root = CORE) {
    const plan = catalog.providers[id];
    if (!plan?.artifacts) return { automatic: false, reason: plan?.manual || '此扩展未登记自动安装方案，请联系维护者。' };
    const result = { automatic: true, targetVersion: plan.version, checkedAt: catalog.checkedAt, sources: [...new Set(plan.artifacts.map(a => new URL(a.url).hostname))], state: 'missing', action: 'install', reason: '按项目核验清单安装，不自动追随上游最新版。' };
    if (process.platform !== plan.platform || process.arch !== plan.arch) return { ...result, automatic: false, reason: '自动安装仅支持 Windows x64。' };
    try {
        const record = active(id, root);
        if (record) {
            result.installedVersion = record.version;
            result.state = record.catalogHash === fingerprint(plan) ? 'current' : 'update';
            result.action = result.state === 'current' ? 'reinstall' : 'update';
        } else {
            const local = id === 'sharp' ? safePath(root, 'node_modules/sharp/package.json') : safePath(root, 'providers/lame/lame.exe');
            if (fs.existsSync(local)) {
                result.state = 'unmanaged';
                result.reason = '当前使用手动安装的依赖；安装核验版本后优先使用受管理副本，原文件保留。';
                if (id === 'sharp') result.installedVersion = JSON.parse(fs.readFileSync(local, 'utf8')).version;
            }
        }
        if (result.installedVersion && newer(result.installedVersion, plan.version)) return { ...result, automatic: false, reason: '本地版本高于核验版本，不自动降级。' };
    } catch (error) { result.state = 'damaged'; result.action = 'repair'; result.reason = error.message; }
    return result;
}
module.exports = { CORE, active, runtimeDirectory, sharpModule, management, fingerprint };
