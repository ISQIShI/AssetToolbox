const fs = require('node:fs');
const path = require('node:path');

// 在独立副本验证核心和配置写入，不改变正在使用的工具设置。
function copyTool(root) {
    const source = path.resolve(__dirname, '../..');
    const tool = path.join(root, 'portable-tool');
    fs.mkdirSync(path.join(tool, 'resCompress'), { recursive: true });
    for (const file of ['resCompress/compress.js', 'resCompress/options.js', 'resCompress/settings.js', 'resCompress/batch.js', 'resCompress/tasks.js', 'resCompress/restore.js', 'resCompress/desktop-bridge.js']) {
        fs.copyFileSync(path.join(source, file), path.join(tool, file));
    }
    fs.cpSync(path.join(source, 'resCompress/compressors'), path.join(tool, 'resCompress/compressors'), {
        recursive: true, filter: filename => path.basename(filename) !== 'user-settings.json',
    });
    return tool;
}

module.exports = { copyTool };
