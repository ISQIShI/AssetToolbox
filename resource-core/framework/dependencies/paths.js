const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function safePath(root, relative) {
    if (typeof relative !== 'string' || !relative || relative.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f<>"|?*]|[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('依赖路径无效：' + relative);
    let current = path.resolve(root);
    for (const part of relative.split('/')) {
        current = path.join(current, part);
        try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('依赖路径不能包含链接'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return current;
}
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function inventory(root, prefix = '') {
    const files = {};
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const relative = prefix + entry.name, filename = safePath(root, entry.name);
        if (entry.isDirectory()) Object.assign(files, inventory(filename, relative + '/'));
        else if (entry.isFile()) files[relative] = hash(fs.readFileSync(filename));
        else throw new Error('依赖包含非普通文件');
    }
    return files;
}
module.exports = { safePath, hash, inventory };
