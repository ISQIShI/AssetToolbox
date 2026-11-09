const fs = require('node:fs');
const path = require('node:path');

// 在独立副本验证核心和配置写入，不改变正在使用的工具设置。
function copyTool(root) {
    const source = path.resolve(__dirname, '../..');
    const tool = path.join(root, 'portable-tool');
    fs.mkdirSync(path.join(tool, 'resource-core'), { recursive: true });
    for (const file of ['resource-core/compress.js', 'resource-core/settings.js', 'resource-core/batch.js', 'resource-core/tasks.js', 'resource-core/restore.js', 'resource-core/desktop-bridge.js']) {
        fs.copyFileSync(path.join(source, file), path.join(tool, file));
    }
    fs.cpSync(path.join(source, 'resource-core/framework'), path.join(tool, 'resource-core/framework'), { recursive: true });
    fs.cpSync(path.join(source, 'resource-core/processors'), path.join(tool, 'resource-core/processors'), {
        recursive: true, filter: filename => path.basename(filename) !== 'user-settings.json',
    });
    return tool;
}

module.exports = { copyTool };
