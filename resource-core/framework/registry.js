const fs = require('node:fs');
const path = require('node:path');
const { compileSchema, normalizeParameters } = require('./schema');
const { providerAvailability } = require('./availability');
const { management } = require('./dependencies/runtime');

const identifier = /^[a-z][a-z0-9-]*$/;
const versionPattern = /^\d+\.\d+\.\d+$/;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
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
        const apiVersions = category === 'providers' ? [2] : category === 'operations' ? [1, 2] : [1];
        if (!apiVersions.includes(definition.apiVersion) || !versionPattern.test(definition.version || '') || typeof definition.displayName !== 'string' || !definition.displayName.trim()) throw new Error('扩展契约无效：' + entry.name);
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
        const policies = operation.apiVersion === 2 ? ['smaller-only', 'valid-output', 'observe'] : ['smaller-only', 'valid-output'];
        if (operation.preserveOriginal !== undefined && (operation.apiVersion !== 2 || typeof operation.preserveOriginal !== 'boolean')) throw new Error('preserveOriginal 需要操作 API 2 的布尔声明');
        if (!policies.includes(operation.resultPolicy) || !Array.isArray(operation.accepts) || !operation.accepts.length) throw new Error('操作定义无效：' + operation.id);
        operation.schema = compileSchema(operation.schema);
    }
    for (const provider of providers.values()) {
        if (provider.requiredFiles !== undefined && (!Array.isArray(provider.requiredFiles) || provider.requiredFiles.some(name => typeof name !== 'string' || !name || path.basename(name) !== name || /[\\/:\0]/.test(name)))) throw new Error('requiredFiles 必须为本目录文件名数组');
        if (provider.acquisition) {
            const url = new URL(provider.acquisition.url);
            if (url.protocol !== 'https:' || url.username || url.password || typeof provider.acquisition.instructions !== 'string' || !provider.acquisition.instructions) throw new Error('提供方获取信息无效');
        }
        if (['execute', 'schema', 'supports'].some(key => Object.hasOwn(provider, key))) throw new Error('提供方旧接口不受支持，请将执行和参数移入 adapters：' + provider.id);
        if (!isRecord(provider.adapters) || !Object.keys(provider.adapters).length) throw new Error('提供方必须声明 adapters：' + provider.id);
        if (provider.prepare !== undefined && typeof provider.prepare !== 'function') throw new Error('prepare 必须为函数');
        if (provider.check !== undefined && typeof provider.check !== 'function') throw new Error('check 必须为函数');
        if (provider.executableName !== undefined && (typeof provider.executableName !== 'string' || !provider.executableName || path.basename(provider.executableName) !== provider.executableName || /[\\/:\0]/.test(provider.executableName))) throw new Error('executableName 必须为本目录文件名');
        const adapters = Object.create(null), supports = [];
        for (const [operationId, adapter] of Object.entries(provider.adapters)) {
            const operation = operations.get(operationId);
            if (!identifier.test(operationId) || !operation || !isRecord(adapter)
                || Object.keys(adapter).some(key => !['version', 'resourceTypes', 'schema', 'execute'].includes(key))
                || !versionPattern.test(adapter.version || '') || typeof adapter.execute !== 'function'
                || !Array.isArray(adapter.resourceTypes) || !adapter.resourceTypes.length) throw new Error('操作适配器定义无效：' + provider.id + '/' + operationId);
            const seen = new Set();
            for (const typeId of adapter.resourceTypes) {
                const type = resourceTypes.get(typeId);
                if (!type || !operation.accepts.includes(type.kind) || seen.has(typeId)) throw new Error('提供方支持关系无效：' + provider.id + '/' + operationId);
                seen.add(typeId);
                supports.push({ resourceType: typeId, operation: operationId });
            }
            adapters[operationId] = { ...adapter, resourceTypes: [...adapter.resourceTypes], schema: compileSchema(adapter.schema) };
        }
        provider.adapters = adapters;
        provider.supports = supports;
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
            const adapter = provider.adapters[operation.id];
            const versions = { resourceType: type.version, operation: operation.version, provider: provider.version, adapter: adapter.version };
            if (step.versions !== undefined && (!step.versions || typeof step.versions !== 'object' || Array.isArray(step.versions) || Object.keys(step.versions).length !== 4 || Object.keys(versions).some(key => step.versions[key] !== versions[key]))) throw new Error('步骤实现版本不匹配（须包含当前适配器版本）：' + step.id);
            return { id: step.id, resourceType: type.id, operation: operation.id, provider: provider.id, enabled: step.enabled,
                parameters: normalizeParameters(operation.schema, step.parameters), providerOptions: normalizeParameters(adapter.schema, step.providerOptions), versions };
        });
    }
    function describe() {
        const base = definition => ({ id: definition.id, displayName: definition.displayName, description: definition.description || '', version: definition.version });
        return { apiVersion: 3,
            resourceTypes: [...resourceTypes.values()].map(type => ({ ...base(type), kind: type.kind, extensions: type.extensions })),
            operations: [...operations.values()].map(operation => ({ ...base(operation), accepts: operation.accepts, resultPolicy: operation.resultPolicy, preserveOriginal: Boolean(operation.preserveOriginal), fields: operation.schema.fields })),
            providers: [...providers.values()].map(provider => ({ ...base(provider), supports: provider.supports,
                adapters: Object.entries(provider.adapters).map(([operation, adapter]) => ({ operation, version: adapter.version, fields: adapter.schema.fields })),
                availability: providerAvailability(provider), acquisition: provider.acquisition || null, dependency: management(provider.id, root) })) };
    }
    return { resourceTypes, operations, providers, byExtension, normalizePipeline, describe };
}
module.exports = { ...createRegistry(), createRegistry };
