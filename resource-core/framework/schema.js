const RESERVED = new Set(['constructor', 'prototype', '__proto__']);

function text(value, label) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`${label}必须是非空文本`);
    return value;
}
function normalizeParameters(config, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('参数必须为对象');
    for (const key of Object.keys(options)) if (!config.fields.some(field => field.key === key)) throw new Error('未知参数：' + key);
    const settings = {};
    for (const field of config.fields) {
        const value = options[field.key] === undefined ? field.default : options[field.key];
        if (field.type === 'integer' || field.type === 'number') {
            if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max ||
                (field.type === 'integer' && !Number.isSafeInteger(value))) {
                throw new Error(`${field.label}必须是 ${field.min} 到 ${field.max} 之间的${field.type === 'integer' ? '整数' : '数值'}`);
            }
            const scaled = value * 10 ** field.decimalPlaces;
            if (Math.abs(scaled - Math.round(scaled)) > 0.00001) throw new Error(`${field.label}最多允许 ${field.decimalPlaces} 位小数`);
        } else if (field.type === 'boolean') {
            if (typeof value !== 'boolean') throw new Error(`${field.label}必须为 true 或 false`);
        } else {
            if (typeof value !== 'string' || value.includes('\0')) throw new Error(`${field.label}必须是文本`);
            if (field.type === 'enum' && !field.choices.some(choice => choice.value === value)) throw new Error(`${field.label}不在可选值中`);
            if (field.type === 'text' && value.length > field.maxLength) throw new Error(`${field.label}最多允许 ${field.maxLength} 个字符`);
        }
        settings[field.key] = value;
    }
    if (config.validate) config.validate(settings);
    return settings;
}

function compileSchema(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('schema 必须为对象');
    const config = { ...input };
    config.defaults = input.defaults || {};
    if (typeof config.defaults !== 'object' || Array.isArray(config.defaults)) throw new Error('defaults 必须是对象');
    const keys = Object.keys(config.defaults);
    if (input.validate !== undefined && typeof input.validate !== 'function') throw new Error('validate 必须是函数');
    const limits = input.limits || {};
    const parameters = input.parameters || {};
    for (const key of [...Object.keys(limits), ...Object.keys(parameters)]) {
        if (!keys.includes(key)) throw new Error(`参数 ${key} 未在 defaults 中定义`);
    }
    config.fields = keys.map(key => {
        if (!/^[a-z][a-zA-Z0-9]*$/.test(key) || RESERVED.has(key.toLowerCase())) throw new Error(`无效或保留的参数名：${key}`);
        const fallback = config.defaults[key], limit = limits[key], metadata = parameters[key] || {};

        const type = metadata.type || (typeof fallback === 'boolean' ? 'boolean' : typeof fallback === 'number' ? (Number.isInteger(fallback) ? 'integer' : 'number') : 'text');
        if (!['integer', 'number', 'boolean', 'enum', 'text'].includes(type)) throw new Error(`参数 ${key} 的控件类型无效`);
        const field = { key, type, default: fallback,
            label: text(metadata.label || (limit && limit.label) || key, `${key} label`),
            hint: metadata.hint === undefined || metadata.hint === '' ? '' : text(metadata.hint, `${key} hint`) };
        if (type === 'integer' || type === 'number') {
            if (!limit || !Number.isFinite(limit.min) || !Number.isFinite(limit.max) || limit.min > limit.max || Math.max(Math.abs(limit.min), Math.abs(limit.max)) > 1e12) throw new Error(`${key} 缺少有效的数值范围（绝对值不能超过 1e12）`);
            if (type === 'integer' && (!Number.isSafeInteger(limit.min) || !Number.isSafeInteger(limit.max))) throw new Error(`${key} 的范围必须为整数`);
            field.min = limit.min; field.max = limit.max;
            field.decimalPlaces = type === 'integer' ? 0 : (metadata.decimalPlaces === undefined ? 2 : metadata.decimalPlaces);
            if (!Number.isInteger(field.decimalPlaces) || field.decimalPlaces < 0 || field.decimalPlaces > 6) throw new Error(`${key} decimalPlaces 必须为 0 到 6 的整数`);
            field.step = metadata.step === undefined ? 10 ** -field.decimalPlaces : metadata.step;
            if (!Number.isFinite(field.step) || field.step <= 0 || field.step > 1e12 || (type === 'integer' && !Number.isSafeInteger(field.step))) throw new Error(`${key} step 无效`);
            if ([field.min, field.max, field.step].some(value => Math.abs(value * 10 ** field.decimalPlaces - Math.round(value * 10 ** field.decimalPlaces)) > 0.00001)) throw new Error(`${key} 范围或步长超出了 decimalPlaces 定义的精度`);
        } else if (limit) throw new Error(`${key} 不是数值参数，不应设置 limits`);
        if (type === 'enum') {
            if (!Array.isArray(metadata.choices) || !metadata.choices.length) throw new Error(`${key} 缺少 choices`);
            field.choices = metadata.choices.map(choice => typeof choice === 'string' ? { label: choice, value: choice } : choice)
                .map(choice => ({ label: text(choice.label, `${key} choice label`), value: text(choice.value, `${key} choice value`) }));
            if (new Set(field.choices.map(choice => choice.value)).size !== field.choices.length) throw new Error(`${key} choices 存在重复值`);
        }
        if (type === 'text') {
            field.maxLength = metadata.maxLength === undefined ? 4096 : metadata.maxLength;
            if (!Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > 32767) throw new Error(`${key} maxLength 必须为 1 到 32767 的整数`);
        }
        return field;
    });
    config.limits = Object.fromEntries(config.fields.filter(field => ['integer', 'number'].includes(field.type)).map(field => [field.key, { label: field.label, min: field.min, max: field.max }]));
    normalizeParameters(config, config.defaults);
    return config;
}

module.exports = { compileSchema, normalizeParameters };
