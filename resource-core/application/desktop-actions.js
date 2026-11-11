const path = require('node:path');

// 只由本地桌面上下文调用；这些设置/路径能力不注册到 Agent 接口。
function normalizeConfiguration(payload) {
    const config = require('../settings').validateConfiguration(payload);
    for (const key of ['sourceDir', 'outputDir', 'backupDir']) {
        const value = config[key].trim().replace(/^"|"$/g, '');
        config[key] = value ? path.resolve(path.join(__dirname, '../..'), value) : '';
    }
    return config;
}
function dispatchDesktop(service, action, payload, catalog) {
    if (!service.context.settings) throw new Error('当前上下文未授权桌面设置');
    switch (action) {
        case 'bootstrap': {
            let config = null, definition = null, configError = null;
            try { config = require('../settings').loadConfiguration(); definition = catalog(); }
            catch (error) { configError = error.message; }
            return { config, definition, warnings: [], configError, root: path.resolve(__dirname, '../..'), nodeVersion: process.version };
        }
        case 'providers': return catalog().providers;
        case 'provider-source': {
            const provider = require('../framework/registry').providers.get(payload.id);
            if (!provider?.acquisition?.url) throw new Error('此提供方没有登记获取渠道');
            return provider.acquisition.url;
        }
        case 'normalize': return normalizeConfiguration(payload);
        case 'save': return require('../settings').saveConfiguration(normalizeConfiguration(payload));
        case 'report': return service.reportLocation(payload.jobId);
        default: throw new Error('未知桌面操作：' + action);
    }
}
module.exports = { dispatchDesktop };
