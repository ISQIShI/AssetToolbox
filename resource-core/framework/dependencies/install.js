const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const catalog = require('./catalog.json');
const { CORE, management, fingerprint } = require('./runtime');
const { safePath, inventory } = require('./paths');
const { download } = require('./download');
const archive = require('./archive');

function smoke(id, directory) {
    const program = id === 'lame' ? path.join(directory, 'lame.exe') : process.execPath;
    const args = id === 'lame' ? ['--version'] : ['-e', 'require(process.argv[1]);', path.join(directory, 'node_modules/sharp')];
    const result = spawnSync(program, args, { cwd: directory, windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    if (result.error || result.status !== 0 || (id === 'lame' && !/4\.0/.test(result.stdout))) throw new Error('下载已验证，但依赖无法运行；原安装保持不变。');
}
// 测试可注入下载与探测；桌面请求只传 ID，不能提供计划、地址、文件名或命令。
async function install(id, { root = CORE, signal, checkCancellation = () => {}, publish = () => {}, fetchArtifact = download, probe = smoke, plan = catalog.providers[id] } = {}) {
    if (!Object.hasOwn(catalog.providers, id) || !plan?.artifacts) throw new Error('此提供方仅支持手动安装');
    if (!management(id, root).automatic) throw new Error(management(id, root).reason);
    const base = safePath(root, `data/dependencies/${id}`);
    const installs = safePath(base, 'installs');
    fs.mkdirSync(installs, { recursive: true });
    const token = randomUUID(), staging = safePath(installs, token);
    fs.mkdirSync(staging);
    let committed = false;
    const pointer = safePath(base, `active-${token}.tmp`);
    const check = () => { checkCancellation(); signal?.throwIfAborted(); };
    try {
        for (const [index, artifact] of plan.artifacts.entries()) {
            check();
            publish({ phase: 'downloading', processed: index, total: plan.artifacts.length, current: new URL(artifact.url).hostname, message: `获取 ${id} ${plan.version}，第 ${index + 1} / ${plan.artifacts.length} 个包` });
            const bytes = await fetchArtifact(artifact, { signal });
            check();
            publish({ phase: 'verifying', message: '下载摘要已匹配，正在检查归档内容。' });
            if (artifact.format === 'zip') archive.zip(bytes, staging, artifact.files);
            else if (artifact.format === 'tgz') archive.tar(bytes, staging, artifact.target);
            else throw new Error('不支持的依赖归档');
        }
        check();
        publish({ phase: 'installing', message: '检查本地加载能力，成功后启用新版本。' });
        probe(id, staging);
        const record = { schema: 1, id, version: plan.version, catalogHash: fingerprint(plan), directory: token, files: inventory(staging), installedAt: new Date().toISOString() };
        fs.writeFileSync(pointer, JSON.stringify(record, null, 2), { flag: 'wx' });
        check();
        // 仅替换小型指针；旧安装不覆盖、不删除，其他进程可继续使用其快照。
        const active = safePath(base, 'active.json');
        for (let attempt = 0; ; attempt++) {
            try { fs.renameSync(pointer, active); break; }
            catch (error) {
                if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 10) throw error;
                await new Promise(resolve => setTimeout(resolve, 50)); check();
            }
        }
        committed = true;
        publish({ phase: 'finished', done: true, processed: plan.artifacts.length, total: plan.artifacts.length, message: `${id} ${plan.version} 已安装并通过完整性校验。`, exitCode: 0 });
        return record;
    } finally {
        if (fs.existsSync(pointer)) fs.unlinkSync(pointer);
        if (!committed) fs.rmSync(staging, { recursive: true, force: true });
    }
}
module.exports = { install, smoke };
