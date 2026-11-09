const { processors } = require('./registry');
const { normalizeModule } = require('./schema');
const FIELDS = Object.freeze(processors.flatMap(processor => processor.config.fields));
const DEFAULTS = Object.freeze(Object.assign({}, ...processors.map(processor => processor.config.defaults)));
const LIMITS = Object.freeze(Object.assign({}, ...processors.map(processor => processor.config.limits)));
const optionFlag = key => '--' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());

function normalizeOptions(options = {}) {
    return Object.assign({}, ...processors.map(processor => normalizeModule(processor.config, options)));
}
function parseOptionValue(field, value) {
    if (typeof value !== 'string' || field.type === 'text' || field.type === 'enum') return value;
    if (field.type === 'boolean') {
        if (!['true', 'false'].includes(value)) throw new Error(`${field.label}必须为 true 或 false`);
        return value === 'true';
    }
    const pattern = field.type === 'integer' ? /^-?\d+$/ : /^-?\d+(\.\d+)?$/;
    if (value.trim() !== value || !pattern.test(value)) throw new Error(`${field.label}必须提供${field.type === 'integer' ? '整数' : '数值'}`);
    return Number(value);
}
function optionsFromValues(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('参数必须是对象');
    const fields = new Map(FIELDS.map(field => [field.key, field]));
    const result = {};
    for (const [key, value] of Object.entries(values)) {
        if (!fields.has(key)) throw new Error(`未知参数：${key}`);
        result[key] = parseOptionValue(fields.get(key), value);
    }
    return normalizeOptions(result);
}
module.exports = { DEFAULTS, LIMITS, FIELDS, optionFlag, normalizeModule, normalizeOptions, parseOptionValue, optionsFromValues };
