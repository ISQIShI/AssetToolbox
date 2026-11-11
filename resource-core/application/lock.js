const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

function alive(pid) {
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
}

// 与任务锁采用相同的竞争声明协议；串行化同一安装中的 GUI、CLI 和 MCP 作业。
function acquire(name = 'execution') {
    const installation = createHash('sha256').update(fs.realpathSync(path.join(__dirname, '..')).toLowerCase()).digest('hex');
    const directory = path.join(fs.realpathSync(require('node:os').tmpdir()), 'asset-toolbox-locks-' + installation, name);
    fs.mkdirSync(directory, { recursive: true });
    const token = randomUUID(), filename = path.join(directory, 'owner.json');
    const claim = path.join(directory, `claim-${process.pid}-${token}`);
    const busy = () => Object.assign(new Error('另一入口正在执行作业，请结束后重试'), { code: 'BUSY' });
    fs.writeFileSync(claim, '', { flag: 'wx' });
    try {
        for (const entry of fs.readdirSync(directory)) {
            const match = /^claim-(\d+)-[a-f0-9-]+$/.exec(entry);
            if (match && entry !== path.basename(claim) && alive(Number(match[1]))) throw busy();
        }
        const write = () => fs.writeFileSync(filename, JSON.stringify({ pid: process.pid, token }), { flag: 'wx' });
        try { write(); }
        catch (error) {
            if (error.code !== 'EEXIST') throw error;
            const before = fs.readFileSync(filename, 'utf8'), previous = JSON.parse(before);
            if (!Number.isSafeInteger(previous.pid) || previous.pid < 1) throw busy();
            if (alive(previous.pid) || fs.readFileSync(filename, 'utf8') !== before) throw busy();
            fs.unlinkSync(filename);
            write();
        }
        return () => {
            if (fs.existsSync(filename) && JSON.parse(fs.readFileSync(filename, 'utf8')).token === token) fs.unlinkSync(filename);
        };
    } finally { fs.unlinkSync(claim); }
}

module.exports = { acquire, alive };
