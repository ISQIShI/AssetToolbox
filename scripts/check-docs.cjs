const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const failures = [];
for (const file of new Set(files)) {
    const content = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^(https?:|mailto:|[A-Z]:|#)/i.test(target)) continue;
        if (!fs.existsSync(path.resolve(root, path.dirname(file), decodeURIComponent(target)))) failures.push(file + ' -> ' + target);
    }
}
console.log(JSON.stringify({ documents: new Set(files).size, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
