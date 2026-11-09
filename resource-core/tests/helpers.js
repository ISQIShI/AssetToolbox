const path = require('node:path');
const fs = require('node:fs');

// 测试构造器：将紧凑的编码器参数用例展开为完整的新步骤契约。
function compressionPipeline(values = {}, core = path.resolve(__dirname, '..')) {
    const { providers } = require(path.join(core, 'framework/registry'));
    return [...providers.values()].filter(provider => provider.supports.some(s => s.operation === 'compress')).map(provider => {
        const resourceType = provider.supports.find(s => s.operation === 'compress').resourceType;
        const prefix = { pngquant: 'png', 'jpg-c': 'jpg', lame: 'mp3' }[provider.id] || provider.id;
        const providerOptions = {};
        for (const key of Object.keys(provider.schema.defaults)) {
            const source = ['pngquant', 'jpg-c', 'lame'].includes(provider.id) ? prefix + key[0].toUpperCase() + key.slice(1) : key;
            if (values[source] !== undefined) providerOptions[key] = values[source];
        }
        return { id: resourceType + '-compress', resourceType, operation: 'compress', provider: provider.id,
            enabled: values[prefix + 'Enabled'] ?? prefix !== 'mp3', parameters: {}, providerOptions };
    });
}
function engineFor(core = path.resolve(__dirname, '..')) {
    const engine = require(path.join(core, 'engine'));
    if (engine.testHarness) return engine;
    const process = engine.processFolder, scan = engine.scanFolder;
    return Object.assign(engine, { testHarness: true,
        processFolder: (folder, options = {}) => process(folder, { ...options, pipeline: options.pipeline || compressionPipeline(options, core) }),
        scanFolder: (folder, options = {}) => scan(folder, { ...options, pipeline: options.pipeline || compressionPipeline(options, core) }),
    });
}
function batchFor(core) {
    const batch = require(path.join(core, 'batch'));
    return { ...batch, runJob: (request, ...args) => {
        if (!['preview', 'process'].includes(request.mode)) return batch.runJob(request, ...args);
        const { options = {}, ...next } = request;
        return batch.runJob({ ...next, pipeline: next.pipeline || compressionPipeline(options, core) }, ...args);
    } };
}
function installType(tool, id) {
    const directory = path.join(tool, 'resource-core/resource-types', id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'index.js'), `module.exports={apiVersion:1,version:'1.0.0',displayName:'测试资源',kind:'image',extensions:['.pack'],validate: data=>data.toString().startsWith('PACK:')};`);
}
module.exports = { compressionPipeline, engineFor, batchFor, installType };
