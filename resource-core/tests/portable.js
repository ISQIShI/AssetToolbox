const fs = require('node:fs');
const path = require('node:path');
function copyTool(root, dependencies = false) {
    const source = path.resolve(__dirname, '..'), tool = path.join(root, 'portable-tool'), core = path.join(tool, 'resource-core');
    fs.mkdirSync(core, { recursive: true });
    for (const file of ['engine.js', 'cli.js', 'settings.js', 'batch.js', 'tasks.js', 'restore.js', 'desktop-bridge.js']) fs.copyFileSync(path.join(source, file), path.join(core, file));
    for (const directory of ['framework', 'resource-types', 'operations', 'providers', ...(dependencies ? ['node_modules'] : [])]) fs.cpSync(path.join(source, directory), path.join(core, directory), { recursive: true });
    return tool;
}
module.exports = { copyTool };
