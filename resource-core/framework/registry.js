const fs = require('node:fs');
const path = require('node:path');
const { compileSchema, normalizeParameters } = require('./schema');
const { providerAvailability } = require('./availability');

const identifier = /^[a-z][a-z0-9-]*$/;
function discover(root, category) {
    const directory = path.join(root, category);
    const result = new Map();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || /^[_.]/.test(entry.name)) continue;
        const filename = path.join(directory, entry.name, 'index.js');
        if (!fs.existsSync(filename)) continue;
        if (!identifier.test(entry.name)) throw new Error('扩展 ID 无效：' + entry.name);
        const definition = require(filename);
        const provenance = path.join(directory, entry.name, 'provenance.json');
        if (category === 'providers' && fs.existsSync(provenance)) definition.acquisition = JSON.parse(fs.readFileSync(provenance, 'utf8'));
        if (definition.apiVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(definition.version || '') || typeof definition.displayName !== 'string' || !definition.displayName.trim()) throw new Error('扩展契约无效：' + entry.name);
        result.set(entry.name, { ...definition, id: entry.name, directory: path.dirname(filename) });
    }
    return result;
}
function createRegistry(root = path.join(__dirname, '..')) {
    const resourceTypes = discover(root, 'resource-types'), operations = discover(root, 'operations'), providers = discover(root, 'providers');
    const byExtension = new Map();
    for (const type of resourceTypes.values()) {
        if (typeof type.kind !== 'string' || !Array.isArray(type.extensions) || !type.extensions.length || typeof type.validate !== 'function') throw new Error('资源类型定义无效：' + type.id);
        for (const extension of type.extensions) {
            if (!/^\.[a-z0-9]+$/.test(extension) || byExtension.has(extension)) throw new Error('扩展名无效或重复：' + extension);
            byExtension.set(extension, type);
        }
    }
    for (const operation of operations.values()) {
        if (!['smaller-only', 'valid-output'].includes(operation.resultPolicy) || !Array.isArray(operation.accepts) || !operation.accepts.length) throw new Error('操作定义无效：' + operation.id);
        operation.schema = compileSchema(operation.schema);
    }
    for (const provider of providers.values()) {
        if (provider.requiredFiles !== undefined && (!Array.isArray(provider.requiredFiles) || provider.requiredFiles.some(name => typeof name !== 'string' || !name || path.basename(name) !== name || /[\\/:\0]/.test(name)))) throw new Error('requiredFiles 必须为本目录文件名数组');
        if (provider.acquisition) {
            const url = new URL(provider.acquisition.url);
            if (url.protocol !== 'https:' || url.username || url.password || typeof provider.acquisition.instructions !== 'string' || !provider.acquisition.instructions) throw new Error('提供方获取信息无效');
        }
        if (typeof provider.execute !== 'function' || !Array.isArray(provider.supports) || !provider.supports.length) throw new Error('提供方定义无效：' + provider.id);
        if (provider.prepare !== undefined && typeof provider.prepare !== 'function') throw new Error('prepare 必须为函数');
        if (provider.check !== undefined && typeof provider.check !== 'function') throw new Error('check 必须为函数');
        if (provider.executableName !== undefined && (typeof provider.executableName !== 'string' || !provider.executableName || path.basename(provider.executableName) !== provider.executableName || /[\\/:\0]/.test(provider.executableName))) throw new Error('executableName 必须为本目录文件名');
        const seen = new Set();
        for (const support of provider.supports) {
            const type = resourceTypes.get(support.resourceType), operation = operations.get(support.operation), key = `${support.resourceType}/${support.operation}`;
            if (!type || !operation || !operation.accepts.includes(type.kind) || seen.has(key)) throw new Error('提供方支持关系无效：' + provider.id);
            seen.add(key);
        }
        provider.schema = compileSchema(provider.schema);
    }
    function normalizePipeline(input) {
        if (!Array.isArray(input) || input.length > 64) throw new Error('处理步骤必须为数组，最多 64 项');
        const seen = new Set();
        return input.map(step => {
            if (!step || typeof step !== 'object' || Array.isArray(step) || typeof step.id !== 'string' || !identifier.test(step.id) || seen.has(step.id) || typeof step.enabled !== 'boolean') throw new Error('步骤 ID/开关无效或重复');
            seen.add(step.id);
            const allowed = ['id', 'resourceType', 'operation', 'provider', 'enabled', 'parameters', 'providerOptions', 'versions'];
            if (Object.keys(step).some(key => !allowed.includes(key))) throw new Error('步骤包含未知字段');
            const type = resourceTypes.get(step.resourceType), operation = operations.get(step.operation), provider = providers.get(step.provider);
            if (!type || !operation || !provider || !provider.supports.some(s => s.resourceType === type.id && s.operation === operation.id)) throw new Error('资源类型、操作与提供方不匹配：' + step.id);
            const versions = { resourceType: type.version, operation: operation.version, provider: provider.version };
            if (step.versions !== undefined && (!step.versions || typeof step.versions !== 'object' || Array.isArray(step.versions) || Object.keys(step.versions).length !== 3 || Object.keys(versions).some(key => step.versions[key] !== versions[key]))) throw new Error('步骤实现版本不匹配：' + step.id);
            return { id: step.id, resourceType: type.id, operation: operation.id, provider: provider.id, enabled: step.enabled,
                parameters: normalizeParameters(operation.schema, step.parameters), providerOptions: normalizeParameters(provider.schema, step.providerOptions), versions };
        });
    }
    function describe() {
        const base = definition => ({ id: definition.id, displayName: definition.displayName, description: definition.description || '', version: definition.version });
        return { apiVersion: 1,
            resourceTypes: [...resourceTypes.values()].map(type => ({ ...base(type), kind: type.kind, extensions: type.extensions })),
            operations: [...operations.values()].map(operation => ({ ...base(operation), accepts: operation.accepts, resultPolicy: operation.resultPolicy, fields: operation.schema.fields })),
            providers: [...providers.values()].map(provider => ({ ...base(provider), supports: provider.supports, fields: provider.schema.fields,
                availability: providerAvailability(provider), acquisition: provider.acquisition || null })) };
    }
    return { resourceTypes, operations, providers, byExtension, normalizePipeline, describe };
}
module.exports = { ...createRegistry(), createRegistry };
