const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DEFAULTS, LIMITS, FIELDS, normalizeModule, normalizeOptions, optionsFromValues } = require('./framework/options');
const { processors } = require('./framework/registry');

const SETTINGS_FILE = path.join(__dirname, 'config', 'user-settings.json');
const SHARED_KEYS = ['sourceDir', 'outputDir', 'backupDir', 'saveMode', 'backupEnabled'];
function defaultConfiguration() {
    // 内存中的扁平结构保持兼容，磁盘上公共配置为 v2，各模块配置为 v1。
    return { version: 1, sourceDir: '', outputDir: '', backupDir: '', saveMode: 'overwrite', backupEnabled: false, ...DEFAULTS };
}
function sharedConfiguration(input) {
    const result = {};
    for (const key of ['sourceDir', 'outputDir', 'backupDir']) {
        if (typeof input[key] !== 'string' || input[key].includes('\0')) throw new Error(`无效的路径配置：${key}`);
        result[key] = input[key];
    }
    if (!['overwrite', 'saveAs'].includes(input.saveMode) || typeof input.backupEnabled !== 'boolean') throw new Error('无效的保存方式');
    result.saveMode = input.saveMode;
    result.backupEnabled = input.backupEnabled;
    return result;
}
function validateConfiguration(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 1) throw new Error('不支持的配置文件格式');
    return { version: 1, ...sharedConfiguration(input), ...normalizeOptions(input) };
}
function configurationFiles(root = __dirname) {
    return {
        shared: path.join(root, 'config', 'user-settings.json'),
        legacy: path.join(root, 'user-settings.json'),
        modules: processors.map(processor => ({ processor, filename: path.join(root, 'processors', processor.id, 'user-settings.json') })),
    };
}
function readJson(filename) {
    return JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
}
function loadConfiguration(root = __dirname, warn = console.error) {
    const files = configurationFiles(root);
    let result = defaultConfiguration();
    try {
        const shared = readJson(files.shared);
        if (!shared || shared.version !== 2) throw new Error('不支持的公共配置版本');
        Object.assign(result, sharedConfiguration(shared));
    } catch (error) {
        if (error.code === 'ENOENT') {
            // 尚未保存新布局时兼容上个版本。加载和取消均不修改旧文件。
            try { result = validateConfiguration(readJson(files.legacy)); }
            catch (legacyError) {
                if (legacyError.code !== 'ENOENT') warn(`无法读取旧配置，已使用默认值：${legacyError.message}`);
            }
        } else warn(`无法读取公共配置，文件夹与保存方式已使用默认值：${error.message}`);
    }
    for (const { processor, filename } of files.modules) {
        try {
            const saved = readJson(filename);
            if (!saved || saved.version !== 1) throw new Error('不支持的模块配置版本');
            // 防止一个工具的配置夹带其他工具或公共设置。
            Object.assign(result, normalizeModule(processor.config, saved));
        } catch (error) {
            if (error.code !== 'ENOENT') {
                Object.assign(result, processor.config.defaults);
                warn(`无法读取 ${processor.id.toUpperCase()} 配置，该工具已使用默认值：${error.message}`);
            }
        }
    }
    return result;
}
function stageFile(filename, data) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const temporary = path.join(path.dirname(filename), `.settings-${randomUUID()}.tmp`);
    let descriptor;
    try {
        descriptor = fs.openSync(temporary, 'wx');
        fs.writeFileSync(descriptor, data);
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        return temporary;
    } catch (error) {
        if (descriptor !== undefined) fs.closeSync(descriptor);
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
        throw error;
    }
}
function saveConfiguration(input, root = __dirname) {
    const config = validateConfiguration(input);
    const files = configurationFiles(root);
    const jobs = [
        ...files.modules.map(({ processor, filename }) => ({ filename, value: { version: 1, ...normalizeModule(processor.config, config) } })),
        // 公共配置最后提交，作为旧格式迁移完成的标志。
        { filename: files.shared, value: { version: 2, ...Object.fromEntries(SHARED_KEYS.map(key => [key, config[key]])) } },
    ];
    const committed = [];
    try {
        // 全部临时文件写入成功后再替换；失败时恢复已经提交的文件。
        for (const job of jobs) {
            try { job.original = fs.readFileSync(job.filename); }
            catch (error) { if (error.code !== 'ENOENT') throw error; job.original = null; }
            job.temporary = stageFile(job.filename, JSON.stringify(job.value, null, 2) + '\n');
        }
        for (const job of jobs) {
            fs.renameSync(job.temporary, job.filename);
            job.temporary = null;
            committed.push(job);
        }
    } catch (error) {
        const rollbackErrors = [];
        for (const job of committed.reverse()) {
            let temporary;
            try {
                if (job.original === null) fs.unlinkSync(job.filename);
                else {
                    temporary = stageFile(job.filename, job.original);
                    fs.renameSync(temporary, job.filename);
                }
            } catch (rollbackError) { rollbackErrors.push(rollbackError); }
            finally { if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary); }
        }
        if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], '配置保存失败，部分旧配置恢复失败，请检查目录写入权限');
        throw error;
    } finally {
        for (const job of jobs) if (job.temporary && fs.existsSync(job.temporary)) fs.unlinkSync(job.temporary);
    }
    return config;
}

function printJson(value) {
    // ASCII JSON 可跨 Windows PowerShell 5.1 的系统代码页恢复中文路径。
    console.log(JSON.stringify(value).replace(/[^\x00-\x7f]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')));
}
if (require.main === module) {
    const [command, payload] = process.argv.slice(2);
    try {
        if (command === '--load') {
            const warnings = [];
            const config = loadConfiguration(__dirname, message => warnings.push(message));
            printJson({ config, warnings });
        } else if (command === '--describe') {
            printJson({ defaults: DEFAULTS, limits: LIMITS, fields: FIELDS, modules: processors.map(processor => ({
                id: processor.id, displayName: processor.config.displayName, description: processor.config.description,
                extensions: processor.extensions, enabledKey: processor.config.enabledKey, fields: processor.config.fields,
            })) });
        } else if (['--normalize-base64', '--normalize-file'].includes(command) && payload) {
            try { printJson({ ok: true, options: optionsFromValues(command.endsWith('-file') ? readJson(payload) : JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))) }); }
            catch (error) { printJson({ ok: false, error: error.message }); }
        } else if (['--save-base64', '--save-file'].includes(command) && payload) {
            saveConfiguration(command.endsWith('-file') ? readJson(payload) : JSON.parse(Buffer.from(payload, 'base64').toString('utf8')));
        } else throw new Error('用法：settings.js --load | --describe | --normalize-base64 <JSON Base64> | --save-base64 <JSON Base64>');
    } catch (error) {
        console.log(`配置操作失败：${error.message}`);
        process.exitCode = 1;
    }
}
module.exports = { SETTINGS_FILE, configurationFiles, defaultConfiguration, validateConfiguration, loadConfiguration, saveConfiguration };
