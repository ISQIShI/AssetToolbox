// Tauri 与现有核心之间的 JSON Lines 接口。仅使用标准输入输出，不监听网络端口。
const fs = require('node:fs');
const path = require('node:path');

const { JobSession } = require('./application/job-session');
function normalizeConfiguration(payload) {
    const config = require('./settings').validateConfiguration(payload);
    for (const key of ['sourceDir', 'outputDir', 'backupDir']) {
        const value = config[key].trim().replace(/^"|"$/g, '');
        config[key] = value ? path.resolve(path.dirname(__dirname), value) : '';
    }
    return config;
}
class DesktopBridge extends JobSession {
    bootstrap() {
        const warnings = [];
        let config = null, definition = null, configError = null;
        try {
            const settings = require('./settings');
            config = settings.loadConfiguration();
            definition = require('./framework/registry').describe();
        } catch (error) { configError = error.message; }
        return { config, definition, warnings, configError, root: path.dirname(__dirname), nodeVersion: process.version };
    }
    async dispatch(action, payload = {}) {
        switch (action) {
            case 'bootstrap': return this.bootstrap();
            case 'tasks': return require('./tasks').listTasks();
            case 'providers': return require('./framework/registry').describe().providers;
            case 'provider-source': {
                const provider = require('./framework/registry').providers.get(payload.id);
                if (!provider?.acquisition?.url) throw new Error('此提供方没有登记获取渠道');
                return provider.acquisition.url;
            }
            case 'normalize': return normalizeConfiguration(payload);
            case 'save': return require('./settings').saveConfiguration(normalizeConfiguration(payload));
            case 'start': return this.start(payload);
            case 'poll': return this.poll(payload.id);
            case 'cancel': return this.cancel(payload.id);
            case 'report': {
                const state = this.poll(payload.id);
                if (!state.done || !state.reportDirectory || !fs.statSync(state.reportDirectory).isDirectory()) throw new Error('本次任务尚无报告');
                return state.reportDirectory;
            }
            default: throw new Error('未知桌面操作：' + action);
        }
    }
}

if (require.main === module) {
    const bridge = new DesktopBridge();
    const input = require('node:readline').createInterface({ input: process.stdin, crlfDelay: Infinity });
    // 模块自己的日志写入 stderr，不能破坏 JSON 协议。
    console.log = (...args) => console.error(...args);
    input.on('line', async line => {
        let message;
        try {
            message = JSON.parse(line);
            const result = await bridge.dispatch(message.action, message.payload);
            process.stdout.write(JSON.stringify({ id: message.id, result }) + '\n');
        } catch (error) { process.stdout.write(JSON.stringify({ id: message?.id, error: error.message }) + '\n'); }
    });
    let stopping = false;
    const stop = async () => {
        if (stopping) return; stopping = true;
        await bridge.shutdown(); process.exit(0);
    };
    input.on('close', stop);
    process.on('SIGTERM', stop);
    // 宿主崩溃时 stdin 通常关闭；额外检查父进程，避免失联后继续处理整批素材。
    const parent = process.ppid;
    setInterval(() => { try { process.kill(parent, 0); } catch { void stop(); } }, 1500).unref();
}
module.exports = { DesktopBridge };
