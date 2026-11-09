const RESERVED = new Set(('version sourceDir outputDir backupDir saveMode backupEnabled log onProgress onFile shouldCancel beforeFile beforeCommit fileList backupSession reuseBackup replaceOutputs preview help h output backup optionsBase64 optionsFile FolderPath OutputPath BackupPath SaveAs EnableBackup Verbose Debug ErrorAction WarningAction InformationAction ProgressAction ErrorVariable WarningVariable InformationVariable OutVariable OutBuffer PipelineVariable WhatIf Confirm constructor prototype __proto__').toLowerCase().split(' '));

function text(value, label) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`${label}必须是非空文本`);
    return value;
}
function normalizeModule(config, options = {}) {
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

function compileConfig(input, id) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('config.js 必须导出配置对象');
    const config = { ...input };
    config.displayName = text(input.displayName, 'displayName');
    config.description = input.description === undefined || input.description === '' ? '' : text(input.description, 'description');
    config.order = input.order === undefined ? 100 : input.order;
    if (!Number.isFinite(config.order)) throw new Error('order 必须是数值');
    if (!Array.isArray(input.extensions) || !input.extensions.length) throw new Error('extensions 必须包含至少一个扩展名');
    config.extensions = input.extensions.map(extension => {
        if (typeof extension !== 'string' || !/^\.[a-z0-9]+$/i.test(extension)) throw new Error(`无效扩展名：${extension}`);
        return extension.toLowerCase();
    });
    if (new Set(config.extensions).size !== config.extensions.length) throw new Error('模块内有重复扩展名');
    if (!input.defaults || typeof input.defaults !== 'object' || Array.isArray(input.defaults)) throw new Error('缺少 defaults');
    const keys = Object.keys(input.defaults);
    if (!keys.includes(input.enabledKey) || typeof input.defaults[input.enabledKey] !== 'boolean') throw new Error('enabledKey 必须指向 defaults 中的布尔开关');
    if (input.validate !== undefined && typeof input.validate !== 'function') throw new Error('validate 必须是函数');
    const limits = input.limits || {};
    const parameters = input.parameters || {};
    for (const key of [...Object.keys(limits), ...Object.keys(parameters)]) {
        if (!keys.includes(key)) throw new Error(`参数 ${key} 未在 defaults 中定义`);
    }
    config.fields = keys.map(key => {
        if (!/^[a-z][a-zA-Z0-9]*$/.test(key) || RESERVED.has(key.toLowerCase())) throw new Error(`无效或保留的参数名：${key}`);
        const fallback = input.defaults[key], limit = limits[key], metadata = parameters[key] || {};
        const isEnable = key === input.enabledKey;
        const type = metadata.type || (typeof fallback === 'boolean' ? 'boolean' : typeof fallback === 'number' ? (Number.isInteger(fallback) ? 'integer' : 'number') : 'text');
        if (!['integer', 'number', 'boolean', 'enum', 'text'].includes(type) || (isEnable && type !== 'boolean')) throw new Error(`参数 ${key} 的控件类型无效`);
        const field = { key, type, default: fallback, isEnable,
            label: text(metadata.label || (limit && limit.label) || (isEnable ? `启用 ${config.displayName}` : key), `${key} label`),
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
    normalizeModule(config, input.defaults);
    return config;
}

module.exports = { compileConfig, normalizeModule };
