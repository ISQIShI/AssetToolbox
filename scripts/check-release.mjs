import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2] || '--source';
if (!['--source', '--portable'].includes(mode)) throw new Error('用法：node scripts/check-release.mjs --source|--portable');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
const failures = [];
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/distribution.md']) if (!fs.existsSync(path.join(root, name))) failures.push('缺少 ' + name);
const files = git(['ls-files']).trim().split('\n');
const history = git(['rev-list', '--objects', 'HEAD']).trim().split('\n').map(line => line.slice(line.indexOf(' ') + 1));
const prohibited = name => /\.(exe|dll|node)$/i.test(name) || /(^|\/)(node_modules|\.local|data)\//.test(name) || /(^|\/)\.env(?:\.|$)/.test(name);
for (const name of new Set([...files, ...history].filter(prohibited))) failures.push('当前分支或可达历史包含禁止上传的文件：' + name);
for (const id of ['pngquant', 'jpg-c', 'lame', 'sharp']) {
    const record = JSON.parse(fs.readFileSync(path.join(root, 'resource-core/providers', id, 'provenance.json'), 'utf8'));
    if (!record.license || !record.version || !record.instructions || !record.url.startsWith('https://')) failures.push('来源/许可/获取说明不完整：' + id);
}
if (mode === '--portable') failures.push('便携二进制发布尚未放行：JPG-C 缺少再分发授权；LAME 构建对应源码与解码库许可、Sharp 原生依赖义务仍需逐包闭合。见 docs/distribution.md。');
console.log(JSON.stringify({ mode, ready: failures.length === 0, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
