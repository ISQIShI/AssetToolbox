// 显式测试分层：不根据依赖是否碰巧存在来跳过用例。
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..', 'resource-core');
const profiles = {
    source: ['adapters', 'application', 'batch', 'contract', 'dependencies', 'desktop', 'http', 'restore-preview', 'restore', 'resume', 'unified', 'storage', 'queue', 'parallel', 'scheduling', 'services', 'lock-races', 'publication', 'filters'],
    codecs: ['audio', 'codecs', 'compress', 'resize', 'resources'],
};
const selected = process.argv[2];
if (!['source', 'codecs', 'all'].includes(selected)) throw Error('用法：node scripts/test-core.cjs source|codecs|all');
const registered = Object.values(profiles).flat().map(name => name + '.test.js').sort();
const actual = fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.js')).sort();
if (JSON.stringify(actual) !== JSON.stringify(registered)) throw Error('测试分层清单与 tests/*.test.js 不一致，请登记新增或删除的测试文件');
if (selected !== 'source') {
    if (process.platform !== 'win32') throw Error('真实编码器验收要求 Windows x64');
    const { providers } = require(path.join(root, 'framework/registry'));
    for (const id of ['pngquant', 'jpg-c', 'lame', 'ffmpeg']) {
        const provider = providers.get(id);
        for (const name of [provider.executableName, ...(provider.requiredFiles || [])]) {
            if (!fs.existsSync(path.join(root, 'providers', id, name))) throw Error('缺少真实验收工具：' + id + '/' + name + '；按工具页及第三方记录安装');
        }
    }
}
const files = (selected === 'all' ? registered : profiles[selected].map(name => name + '.test.js')).map(name => path.join(root, 'tests', name));
console.log(`核心测试层：${selected}，${files.length} 个文件`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
