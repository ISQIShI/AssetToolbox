const SCHEMA = 'asset-toolbox.filter/1';
const fail = message => { throw Object.assign(Error(message), { code: 'INVALID_REQUEST' }); };
const record = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Object.keys(value).every(key => keys.includes(key));
function normalizeFilter(input, catalog, resourceType) {
    if (input === undefined) return { schema: SCHEMA, any: [] };
    if (!record(input, ['schema', 'any']) || input.schema !== SCHEMA || !Array.isArray(input.any) || input.any.length > 16) fail('过滤器必须使用 filter/1，最多 16 组条件');
    let count = 0;
    return { schema: SCHEMA, any: input.any.map(group => {
        if (!record(group, ['all']) || !Array.isArray(group.all) || !group.all.length || group.all.length > 16) fail('每组过滤条件须有 1–16 项');
        return { all: group.all.map(rule => {
            if (++count > 64 || !record(rule, ['property', 'operator', 'value', 'version'])) fail('过滤器最多 64 项，且不能包含未知字段');
            const property = catalog.properties.get(rule.property);
            if (!property || resourceType && !property.resourceTypes.includes(resourceType)) fail('过滤属性不存在或不适用于此资源类型：' + rule.property);
            if (!property.operators.includes(rule.operator) || typeof rule.value !== property.type
                || property.type === 'number' && (!Number.isFinite(rule.value) || Math.abs(rule.value) > Number.MAX_SAFE_INTEGER)
                || property.type === 'string' && (rule.value.length > 1024 || rule.value.includes('\0'))) fail('过滤运算符或值无效：' + rule.property);
            if (rule.version !== undefined && rule.version !== property.version) fail('过滤属性实现版本不匹配：' + rule.property);
            return { property: rule.property, operator: rule.operator, value: rule.value, version: property.version };
        }) };
    }) };
}
function matches(filter, get) {
    return !filter.any.length || filter.any.some(group => group.all.every(rule => {
        const value = get(rule.property);
        // 不适用不等于“值不同”；避免 ne 意外选中其他资源类型。
        if (value === undefined) return false;
        switch (rule.operator) {
            case 'eq': return value === rule.value;
            case 'ne': return value !== rule.value;
            case 'gt': return value > rule.value;
            case 'gte': return value >= rule.value;
            case 'lt': return value < rule.value;
            case 'lte': return value <= rule.value;
            case 'contains': return value.includes(rule.value);
            case 'starts-with': return value.startsWith(rule.value);
            case 'ends-with': return value.endsWith(rule.value);
            default: throw Error('过滤运算符未规范化');
        }
    }));
}
module.exports = { SCHEMA, normalizeFilter, matches };
