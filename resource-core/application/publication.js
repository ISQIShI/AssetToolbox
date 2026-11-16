const fs = require('node:fs');
const path = require('node:path');

function absent(filename) {
    try { fs.lstatSync(filename); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    throw Object.assign(new Error('作业记录已存在，拒绝覆盖：' + path.basename(filename)), { code: 'EEXIST' });
}

// 只用于首次发布的内部作业记录。目录预约串行化同名写者，目标始终不存在或为完整 JSON。
// 不用硬链接发布，避免短暂 nlink=2 与存储维护的硬链接拒绝规则冲突。
function writeExclusive(filename, value) {
    const reservation = filename + '.writing';
    fs.mkdirSync(reservation);
    const temporary = path.join(reservation, 'value.json');
    try {
        absent(filename);
        const fd = fs.openSync(temporary, 'wx');
        try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
        absent(filename);
        fs.renameSync(temporary, filename);
    } finally {
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        fs.rmdirSync(reservation);
    }
}

function publishJob(directory, meta) {
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    const staging = fs.mkdtempSync(path.join(path.dirname(directory), '.pending-'));
    try {
        writeExclusive(path.join(staging, 'job.json'), meta);
        absent(directory);
        fs.renameSync(staging, directory);
    } finally {
        // 只清理本调用生成的未公布元数据；崩溃遗留目录不自动接管或扫描为作业。
        if (fs.existsSync(staging)) {
            try { fs.unlinkSync(path.join(staging, 'job.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
            fs.rmdirSync(staging);
        }
    }
}

module.exports = { writeExclusive, publishJob };
