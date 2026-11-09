// Tauri 与现有核心之间的 JSON Lines 接口。仅使用标准输入输出，不监听网络端口。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const MODES = new Set(['preview', 'compress', 'resume', 'retry', 'restore', 'restore-retry', 'restore-export', 'restore-preview', 'restore-export-preview']);
function normalizeConfiguration(payload) {
    const config = require('./settings').validateConfiguration(payload);
    for (const key of ['sourceDir', 'outputDir', 'backupDir']) {
        const value = config[key].trim().replace(/^"|"$/g, '');
        config[key] = value ? path.resolve(path.dirname(__dirname), value) : '';
    }
    return config;
}
class DesktopBridge {
    constructor() { this.job = null; this.closing = false; }
    bootstrap() {
        const warnings = [];
        let config = null, definition = null, configError = null;
        try {
            const settings = require('./settings');
            config = settings.loadConfiguration(__dirname, message => warnings.push(message));
            const { DEFAULTS, FIELDS } = require('./options');
            definition = { defaults: DEFAULTS, fields: FIELDS, modules: require('./compressors').adapters.map(adapter => ({
                id: adapter.id, displayName: adapter.config.displayName, description: adapter.config.description,
                extensions: adapter.extensions, enabledKey: adapter.config.enabledKey, fields: adapter.config.fields,
            })) };
        } catch (error) { configError = error.message; }
        return { config, definition, warnings, configError, root: path.dirname(__dirname), nodeVersion: process.version };
    }
    async dispatch(action, payload = {}) {
        switch (action) {
            case 'bootstrap': return this.bootstrap();
            case 'tasks': return require('./tasks').listTasks();
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
    start(request) {
        if (this.closing) throw new Error('应用正在退出');
        if (this.job && !this.job.exited) throw new Error('请等待当前任务结束');
        if (!request || !MODES.has(request.mode)) throw new Error('无效任务模式');
        if (['preview', 'compress'].includes(request.mode)) {
            if (typeof request.folder !== 'string' || !request.folder.trim()) throw new Error('请选择源文件夹');
            request = { ...request, options: require('./options').optionsFromValues(request.options || {}) };
        }
        this.cleanup();
        const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'resource-desktop-'));
        const job = { id: randomUUID(), directory, exited: false, state: { phase: 'starting', done: false, processed: 0, total: 0 }, stderr: '' };
        try {
            const filename = path.join(directory, 'request.json');
            fs.writeFileSync(filename, JSON.stringify(request), { flag: 'wx' });
            job.child = spawn(process.execPath, [path.join(__dirname, 'batch.js'), filename], {
                cwd: __dirname, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
            });
            this.job = job;
            job.child.stderr.on('data', data => { job.stderr = (job.stderr + data.toString()).slice(-8000); });
            job.completion = new Promise(resolve => {
                job.child.on('error', error => { job.error = error.message; });
                job.child.once('close', code => { job.exited = true; job.code = code; resolve(); });
            });
            return { id: job.id };
        } catch (error) {
            fs.rmSync(directory, { recursive: true, force: true });
            throw error;
        }
    }
    current(id) {
        if (!this.job || this.job.id !== id) throw new Error('任务会话已失效，请从任务历史继续');
        return this.job;
    }
    poll(id) {
        const job = this.current(id);
        try { job.state = JSON.parse(fs.readFileSync(path.join(job.directory, 'status.json'), 'utf8')); }
        catch (error) { if (!['ENOENT', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code)) job.error = error.message; }
        // 必须等待进程退出和锁释放后才允许启动下一项任务。
        if (!job.exited) return { ...job.state, done: false };
        if (!job.state.done) return { ...job.state, done: true, phase: 'finished', exitCode: 1,
            error: job.error || job.stderr || `工作进程意外退出（${job.code}），可从任务历史继续未完成文件。` };
        return job.state;
    }
    cancel(id) {
        const job = this.current(id);
        if (!job.exited) fs.writeFileSync(path.join(job.directory, 'cancel'), '');
        return { requested: true };
    }
    cleanup() {
        if (this.job?.exited) { fs.rmSync(this.job.directory, { recursive: true, force: true }); this.job = null; }
    }
    async shutdown() {
        this.closing = true;
        if (this.job && !this.job.exited) { this.cancel(this.job.id); await this.job.completion; }
        this.cleanup();
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
