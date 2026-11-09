const fs = require('node:fs');
const path = require('node:path');
const { compileConfig } = require('./schema');

function discoverProcessors(root = path.join(__dirname, '../processors')) {
    const processors = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        // 只加载直接子目录；_ / . 开头的模板、停用目录，以及链接均不加载。
        if (!entry.isDirectory() || /^[_.]/.test(entry.name)) continue;
        const directory = path.join(root, entry.name);
        const configFile = path.join(directory, 'config.js'), implementationFile = path.join(directory, 'index.js');
        if (!fs.existsSync(configFile) && !fs.existsSync(implementationFile)) continue;
        try {
            if (!/^[a-z][a-z0-9_-]*$/.test(entry.name)) throw new Error('目录名须为小写字母开头，后接小写字母、数字、下划线或连字符');
            if (!fs.existsSync(configFile) || !fs.existsSync(implementationFile)) throw new Error('模块需要同时提供 config.js 和 index.js');
            const config = compileConfig(require(configFile), entry.name);
            const implementation = require(implementationFile);
            for (const method of ['validate', 'compress']) if (typeof implementation[method] !== 'function') throw new Error(`index.js 缺少 ${method} 方法`);
            for (const method of ['prepare', 'shouldCompress']) if (implementation[method] !== undefined && typeof implementation[method] !== 'function') throw new Error(`${method} 必须是函数`);
            if (implementation.executableName !== undefined) {
                const executable = implementation.executableName;
                if (typeof executable !== 'string' || !executable || path.basename(executable) !== executable || /[\\/:\0]/.test(executable)) throw new Error('executableName 必须是模块目录内的文件名');
            }
            processors.push({ ...implementation, id: entry.name, directory, config, extensions: config.extensions,
                isEnabled: settings => settings[config.enabledKey] && (!implementation.shouldCompress || implementation.shouldCompress(settings)) });
        } catch (error) { throw new Error(`处理器模块 ${entry.name} 加载失败：${error.message}`); }
    }
    processors.sort((a, b) => a.config.order - b.config.order || a.id.localeCompare(b.id));
    const byExtension = new Map(), parameterOwners = new Map();
    for (const processor of processors) {
        for (const extension of processor.extensions) {
            if (byExtension.has(extension)) throw new Error(`扩展名 ${extension} 同时由 ${byExtension.get(extension).id} 和 ${processor.id} 处理`);
            byExtension.set(extension, processor);
        }
        for (const field of processor.config.fields) {
            const canonical = field.key.toLowerCase();
            if (parameterOwners.has(canonical)) throw new Error(`参数名 ${field.key} 在 ${parameterOwners.get(canonical)} 和 ${processor.id} 中重复`);
            parameterOwners.set(canonical, processor.id);
        }
    }
    return { processors, byExtension };
}

module.exports = { ...discoverProcessors(), discoverProcessors };
