const fs = require('node:fs');
const path = require('node:path');
const operators = { number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'], string: ['eq', 'ne', 'contains', 'starts-with', 'ends-with'], boolean: ['eq', 'ne'] };
function createProperties(root, resourceTypes) {
    const groups = new Map(), properties = new Map(), directory = path.join(root, 'properties');
    if (fs.existsSync(directory)) for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || /^[_.]/.test(entry.name)) continue;
        const filename = path.join(directory, entry.name, 'index.js');
        if (!fs.existsSync(filename)) continue;
        const group = require(filename);
        if (!/^[a-z][a-z0-9-]*$/.test(entry.name) || group.apiVersion !== 1 || !/^\d+\.\d+\.\d+$/.test(group.version)
            || typeof group.common !== 'boolean' || typeof group.read !== 'function' || !group.fields || typeof group.fields !== 'object') throw Error('属性组定义无效：' + entry.name);
        groups.set(entry.name, group);
        const types = [...resourceTypes.values()].filter(type => group.common || type.propertyGroups?.includes(entry.name)).map(type => type.id);
        for (const [id, field] of Object.entries(group.fields)) {
            if (!/^[a-z][a-z0-9-]*$/.test(id) || properties.has(id) || !operators[field.type] || typeof field.label !== 'string') throw Error('属性定义无效或重复：' + id);
            properties.set(id, { ...field, id, group: entry.name, version: group.version, resourceTypes: types, operators: operators[field.type] });
        }
    }
    for (const type of resourceTypes.values()) if (type.propertyGroups !== undefined && (!Array.isArray(type.propertyGroups)
        || type.propertyGroups.some(id => !groups.has(id)) || new Set(type.propertyGroups).size !== type.propertyGroups.length)) throw Error('资源属性组无效：' + type.id);
    function context({ filename, relativePath, resourceType, buffer, stat }) {
        const cache = new Map();
        const readPrefix = length => {
            if (buffer) return buffer.subarray(0, length);
            const fd = fs.openSync(filename, 'r');
            try { const data = Buffer.alloc(Math.min(length, stat.size)); const size = fs.readSync(fd, data, 0, data.length, 0); return data.subarray(0, size); }
            finally { fs.closeSync(fd); }
        };
        return id => {
            const property = properties.get(id);
            if (!property || !property.resourceTypes.includes(resourceType.id)) return undefined;
            if (!cache.has(property.group)) {
                const values = groups.get(property.group).read({ filename, relativePath, resourceType, buffer, stat, readPrefix });
                if (!values || values.then || typeof values !== 'object') throw Error('属性读取必须同步返回对象');
                cache.set(property.group, values);
            }
            const value = cache.get(property.group)[id];
            if (typeof value !== property.type || property.type === 'number' && !Number.isFinite(value)) throw Error('无法取得有效属性：' + property.label);
            return value;
        };
    }
    return { properties, context, describe: () => [...properties.values()] };
}
module.exports = { createProperties, operators };
