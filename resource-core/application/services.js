const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { acquire, alive } = require('./lock');
const { safe } = require('./storage');
const { fail, record, normalizePolicy } = require('./policy');
const root = path.resolve(__dirname, '../data/services');
const file = name => path.join(root, name);
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function read(name) { const filename = file(name); return safe(filename, false, true) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : null; }
function write(name, value, raw = false) {
    safe(root, true, true); fs.mkdirSync(root, { recursive: true }); safe(root, true); safe(file(name), false, true);
    const temporary = file(randomUUID() + '.next');
    try {
        const fd = fs.openSync(temporary, 'wx', 0o600);
        try { fs.writeFileSync(fd, raw ? value : JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(temporary, file(name));
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function config() {
    const value = read('config.json');
    if (!value) return null;
    record(value, ['schema', 'port', 'mcp', 'policy']);
    if (value.schema !== 'asset-toolbox.services/1') fail('UNSUPPORTED_VERSION', '服务配置格式不支持');
    validate(value);
    return value;
}
function validate(value) {
    if (!Number.isInteger(value.port) || value.port < 0 || value.port > 65535 || typeof value.mcp !== 'boolean') fail('INVALID_REQUEST', '端口必须为 0–65535 整数，mcp 必须为布尔值');
    const policy = normalizePolicy(value.policy);
    if (digest(policy) !== digest(value.policy)) fail('INVALID_REQUEST', '权限目录或字段已变化，请重新配置');
}
function runtime() {
    const value = read('runtime.json');
    if (!value) return null;
    if (value.schema !== 'asset-toolbox.service-runtime/1' || !/^[a-f0-9-]{36}$/.test(value.id) || !Number.isSafeInteger(value.pid) || value.pid < 1 || !['starting', 'running', 'stopping', 'stopped'].includes(value.state)) fail('UNSUPPORTED_VERSION', '服务运行记录无效');
    return { ...value, state: value.state !== 'stopped' && !alive(value.pid) ? 'interrupted' : value.state };
}
const active = value => value && ['starting', 'running', 'stopping'].includes(value.state);
function authorize(service, configured) {
    if (service.policy && (!service.policy.allowServiceManagement || !configured || digest(service.policy) !== digest(configured.policy))) fail('PERMISSION_DENIED', '启动权限未授权管理此服务，或配置权限与当前上下文不同');
}
function token() {
    const filename = file('token.txt');
    if (!safe(filename, false, true)) fs.writeFileSync(filename, randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 });
    safe(filename, false);
    if (fs.statSync(filename).size > 256) fail('INVALID_REQUEST', '服务令牌文件无效');
    const value = fs.readFileSync(filename, 'utf8').trim();
    if (!require('./http').validToken(value)) fail('INVALID_REQUEST', '服务令牌文件无效');
    return value;
}
class ServiceHost {
    constructor(service) { this.service = service; this.server = null; this.timer = null; this.id = null; this.closing = null; }
    status() {
        const configured = config(); authorize(this.service, configured);
        const state = runtime();
        return { configured: Boolean(configured), config: configured, state: state?.state || 'stopped', endpoints: active(state) ? state.endpoints || null : null, owned: Boolean(this.id && state?.id === this.id), lifetime: 'owner', tokenFile: configured ? file('token.txt') : null };
    }
    configure(input) {
        if (this.service.session.closing) fail('BUSY', '启动入口正在退出');
        const release = acquire('services');
        try {
            const previous = config(); authorize(this.service, previous);
            if (active(runtime())) fail('BUSY', '先停止服务，再修改配置');
            const next = { schema: 'asset-toolbox.services/1', port: input.port, mcp: input.mcp, policy: normalizePolicy(input.policy) };
            validate(next); authorize(this.service, next);
            // Agent 只能保持启动权限；新增授权只能由受信任本地操作者完成。
            // 权限发生变化时轮换令牌，旧 HTTP 客户端不能继承扩大后的授权。
            safe(root, true, true); fs.mkdirSync(root, { recursive: true }); token();
            if (previous && digest(previous.policy) !== digest(next.policy)) write('token.txt', randomBytes(32).toString('base64url') + '\n', true);
            write('policy.json', next.policy); write('config.json', next);
            return this.status();
        } finally { release(); }
    }
    start() {
        if (this.starting) return this.starting;
        this.starting = this.launch().finally(() => { this.starting = null; });
        return this.starting;
    }
    async launch() {
        if (this.service.session.closing) fail('BUSY', '启动入口正在退出');
        const release = acquire('services');
        let recordValue;
        try {
            const configured = config(); authorize(this.service, configured);
            if (!configured) fail('NOT_READY', '请先配置服务目录权限与端口');
            const previous = runtime();
            if (active(previous)) return { ...this.status(), reused: true };
            const { ApplicationService } = require('./service');
            write('policy.json', configured.policy);
            const child = new ApplicationService(require('./context').policyContext(file('policy.json'), 'server'));
            const id = randomUUID();
            recordValue = { schema: 'asset-toolbox.service-runtime/1', id, pid: process.pid, state: 'starting', endpoints: null };
            write('runtime.json', recordValue);
            try { this.server = await require('./transports').startHttp(child, { ...configured, token: token() }); }
            catch (error) { await child.shutdown(); throw error; }
            if (this.service.session.closing) fail('BUSY', '启动入口正在退出');
            this.id = id; this.closing = null;
            write('runtime.json', { ...recordValue, state: 'running', endpoints: this.server.endpoints });
            this.timer = setInterval(() => { try { if (read('stop.json')?.id === this.id) void this.close().catch(error => console.error(error.message)); } catch (error) { console.error(error.message); void this.close(); } }, 200);
            return { ...this.status(), reused: false };
        } catch (error) {
            if (recordValue) { await this.server?.close(); this.server = null; this.id = null; write('runtime.json', { ...recordValue, state: 'stopped' }); }
            throw error;
        } finally { release(); }
    }
    stop() {
        const release = acquire('services');
        try {
            authorize(this.service, config()); const value = runtime();
            if (active(value)) write('stop.json', { id: value.id });
            return { requested: true, state: active(value) ? 'stopping' : value?.state || 'stopped' };
        } finally { release(); }
    }
    clientConfig({ transport }) {
        if (!['stdio', 'http'].includes(transport)) fail('INVALID_REQUEST', 'transport 必须为 stdio 或 http');
        const value = this.status(); if (!value.configured) fail('NOT_READY', '请先配置服务');
        const node = path.resolve(__dirname, '../../runtime/node.exe'), server = path.resolve(__dirname, '../../agent-mcp/server.mjs');
        if (transport === 'stdio') return { transport, mcpServers: { 'asset-toolbox': { command: fs.existsSync(node) ? node : process.execPath, args: [server, '--policy', file('policy.json')] } }, instructions: '由 Agent 宿主启动独立 stdio 会话；需要 agent-mcp 及其 npm 依赖。断连取消该会话自己的作业。' };
        if (value.state !== 'running') fail('NOT_READY', '先启动 HTTP 服务以获取实际端口');
        return { transport, ...value.endpoints, tokenFile: value.tokenFile, headers: { Authorization: 'Bearer <从本机令牌文件读取>' }, instructions: '令牌不在响应或日志中返回；在本机读取 tokenFile 填入 Authorization。关闭启动入口会停止服务。' };
    }
    async close() {
        await this.starting?.catch(() => {});
        if (!this.server) return;
        this.closing ||= (async () => {
            clearInterval(this.timer);
            let value;
            try { value = runtime(); if (value?.id === this.id) write('runtime.json', { ...value, state: 'stopping' }); }
            catch (error) { console.error('服务运行记录无法更新：' + error.message); }
            try { await this.server.close(); }
            finally {
                try { if (value && runtime()?.id === this.id) write('runtime.json', { ...value, state: 'stopped', endpoints: null }); }
                catch (error) { console.error('服务已停止，运行记录无法更新：' + error.message); }
                this.server = null; this.id = null;
            }
        })();
        return this.closing;
    }
}
module.exports = { ServiceHost };
