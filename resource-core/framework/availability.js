const fs = require('node:fs');
const path = require('node:path');
const { runtimeDirectory } = require('./dependencies/runtime');

function providerAvailability(provider) {
    let directory;
    try { directory = runtimeDirectory(provider); }
    catch (error) { return { available: false, reason: error.message }; }
    const required = [...new Set([provider.executableName, ...(provider.requiredFiles || [])].filter(Boolean))];
    const missing = required.filter(name => {
        try { return !fs.statSync(path.join(directory, name)).isFile(); } catch { return true; }
    });
    if (missing.length) return { available: false, reason: '缺少文件：' + missing.join('、') };
    try { provider.check?.(); return { available: true, reason: '' }; }
    catch { return { available: false, reason: '依赖无法加载，请按获取说明安装完整依赖后刷新检查。' }; }
}
module.exports = { providerAvailability };
