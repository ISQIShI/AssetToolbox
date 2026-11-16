import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
const pattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.([1-9]\d*))?$/;
export function parseVersion(value) {
    const match = pattern.exec(value);
    if (!match || [match[1], match[2], match[3], match[5] || '0'].some(part => !Number.isSafeInteger(Number(part)))) {
        throw new Error('版本必须为 X.Y.Z 或 X.Y.Z-alpha.N / beta.N / rc.N，N 从 1 开始，不含前导零或构建后缀');
    }
    return { value, parts: match.slice(1, 4).map(Number), stage: match[4], sequence: Number(match[5] || 0) };
}
export function compareVersions(left, right) {
    const a = parseVersion(left), b = parseVersion(right);
    for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return Math.sign(a.parts[i] - b.parts[i]);
    const rank = { alpha: 0, beta: 1, rc: 2, stable: 3 };
    return Math.sign(rank[a.stage || 'stable'] - rank[b.stage || 'stable']) || Math.sign(a.sequence - b.sequence);
}

// 只更新项目自身版本；依赖、schema、适配器版本各自独立管理。
function entries(directory) {
    const result = [];
    for (const packageDir of ['resource-core', 'desktop', 'agent-mcp']) {
        for (const name of ['package.json', 'package-lock.json']) {
            const file = `${packageDir}/${name}`, value = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
            result.push({ file, versions: [value.version, ...(name === 'package-lock.json' ? [value.packages?.['']?.version] : [])], update(version) {
                value.version = version;
                if (name === 'package-lock.json') value.packages[''].version = version;
                return JSON.stringify(value, null, 2) + '\n';
            } });
        }
    }
    const file = 'desktop/src-tauri/tauri.conf.json', value = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    result.push({ file, versions: [value.version], update(version) { value.version = version; return JSON.stringify(value, null, 2) + '\n'; } });
    for (const name of ['Cargo.toml', 'Cargo.lock']) {
        const file = `desktop/src-tauri/${name}`, text = fs.readFileSync(path.join(directory, file), 'utf8');
        const expression = /(\[(?:\[package\]|package)\][\s\S]*?\bname = "asset-toolbox"\r?\nversion = ")([^"\r\n]+)(")/;
        const match = expression.exec(text);
        if (!match) throw new Error(`${file} 找不到 asset-toolbox 自身版本`);
        result.push({ file, versions: [match[2]], update(version) { return text.replace(expression, (_, before, old, after) => before + version + after); } });
    }
    return result;
}
export function checkVersions(directory = root) {
    const version = fs.readFileSync(path.join(directory, 'VERSION'), 'utf8').trim();
    parseVersion(version);
    for (const entry of entries(directory)) {
        if (entry.versions.some(value => value !== version)) throw new Error(`${entry.file} 与 VERSION=${version} 不一致`);
    }
    return version;
}
export function setVersion(version, directory = root) {
    parseVersion(version); checkVersions(directory);
    const changes = entries(directory).map(entry => ({ file: entry.file, text: entry.update(version) }));
    for (const entry of changes) fs.writeFileSync(path.join(directory, entry.file), entry.text);
    fs.writeFileSync(path.join(directory, 'VERSION'), version + '\n');
    return checkVersions(directory);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [command = '--check', value, ...extra] = process.argv.slice(2);
    if (extra.length || (command === '--check' && value) || !['--check', '--set'].includes(command)) throw new Error('用法：node scripts/version.mjs --check | --set 1.2.3[-rc.1]');
    console.log(command === '--set' ? setVersion(value) : checkVersions());
}
