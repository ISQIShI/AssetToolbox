const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { normalizePipeline, normalizeFilter, providers } = require('./framework/registry');
const SETTINGS_FILE = path.join(__dirname, 'data', 'settings.json');
function defaultConfiguration() {
    const pipeline = [['png', 'pngquant', true], ['jpg', 'jpg-c', true], ['mp3', 'lame', false]]
        .filter(([, provider]) => providers.has(provider)).map(([resourceType, provider, enabled]) => ({ id: resourceType + '-compress', resourceType, operation: 'compress', provider, enabled }));
    return { schema: 'asset-toolbox.settings/3', sourceDir: '', outputDir: '', backupDir: '', saveMode: 'saveAs', backupEnabled: false, sourceFilter: normalizeFilter(), pipeline: normalizePipeline(pipeline) };
}
function validateConfiguration(input) {
    if (!input || input.schema !== 'asset-toolbox.settings/3' || Object.keys(input).some(key => !['schema', 'sourceDir', 'outputDir', 'backupDir', 'saveMode', 'backupEnabled', 'pipeline', 'sourceFilter'].includes(key))) throw new Error('不支持的设置契约');
    for (const key of ['sourceDir', 'outputDir', 'backupDir']) if (typeof input[key] !== 'string' || input[key].includes('\0')) throw new Error('无效的路径配置：' + key);
    if (!['overwrite', 'saveAs'].includes(input.saveMode) || typeof input.backupEnabled !== 'boolean') throw new Error('无效的保存方式');
    return { schema: input.schema, sourceDir: input.sourceDir, outputDir: input.outputDir, backupDir: input.backupDir,
        saveMode: input.saveMode, backupEnabled: input.backupEnabled, sourceFilter: normalizeFilter(input.sourceFilter), pipeline: normalizePipeline(input.pipeline) };
}
function loadConfiguration(root = path.join(__dirname, 'data')) {
    const filename = path.join(root, 'settings.json');
    try { return validateConfiguration(JSON.parse(fs.readFileSync(filename, 'utf8'))); }
    catch (error) { if (error.code === 'ENOENT') return defaultConfiguration(); throw new Error('无法读取设置：' + error.message); }
}
function saveConfiguration(input, root = path.join(__dirname, 'data')) {
    const config = validateConfiguration(input), filename = path.join(root, 'settings.json');
    fs.mkdirSync(root, { recursive: true });
    const temporary = path.join(root, '.settings-' + randomUUID() + '.tmp');
    try {
        const fd = fs.openSync(temporary, 'wx');
        try { fs.writeFileSync(fd, JSON.stringify(config, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(temporary, filename);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return config;
}
module.exports = { SETTINGS_FILE, defaultConfiguration, validateConfiguration, loadConfiguration, saveConfiguration };
