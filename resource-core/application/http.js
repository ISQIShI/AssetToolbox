const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const { ACTION_FIELDS, respond } = require('./service');

const MAX_BODY_BYTES = 1024 * 1024;
const errorResponse = (code, message) => ({ schema: 'asset-toolbox.response/1', ok: false, error: { code, message } });
const statusCodes = { INVALID_REQUEST: 400, UNSUPPORTED_VERSION: 400, PATH_FORBIDDEN: 403, PERMISSION_DENIED: 403, NOT_FOUND: 404, BUSY: 409, IDEMPOTENCY_CONFLICT: 409, NOT_READY: 409, DEPENDENCY_MISSING: 422, MANUAL_INSTALL_REQUIRED: 422 };
function validToken(token) { return typeof token === 'string' && /^[A-Za-z0-9_-]{32,128}$/.test(token); }
function send(res, status, body) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
}
async function readJson(req) {
    const chunks = []; let size = 0;
    // 不使用 for-await 提前 break，以免销毁 socket 后无法返回 413。
    await new Promise((resolve, reject) => {
        const cleanup = () => { req.removeListener('data', data); req.removeListener('end', end); req.removeListener('error', error); req.removeListener('aborted', aborted); };
        const error = cause => { cleanup(); reject(cause); };
        const aborted = () => error(Object.assign(new Error('请求已中断'), { code: 'REQUEST_ABORTED' }));
        const end = () => { cleanup(); resolve(); };
        const data = chunk => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                cleanup(); req.resume();
                reject(Object.assign(new Error('请求体超过 1 MiB'), { code: 'PAYLOAD_TOO_LARGE' }));
            } else chunks.push(chunk);
        };
        req.on('data', data); req.once('end', end); req.once('error', error); req.once('aborted', aborted);
    });
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw Object.assign(new Error('请求体必须为 UTF-8 JSON'), { code: 'INVALID_REQUEST' }); }
}

// 一个进程代表一个本地授权主体。HTTP 请求结束不结束应用作业。
function createHttpServer({ service, token, port = 8787, mcpHandler, closeMcp = async () => {} }) {
    if (!service || service.desktop) throw new Error('HTTP 只能使用受启动 policy 限制的应用服务');
    if (!validToken(token)) throw new Error('HTTP 令牌必须为 32–128 个英文、数字、下划线或短横线');
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('HTTP 端口必须为 0–65535 的整数');
    const expected = Buffer.from(token);
    let closing = false, stopping;
    const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 15000, headersTimeout: 10000, keepAliveTimeout: 5000 }, (req, res) => {
        void handle(req, res).catch(error => {
            if (res.headersSent) { res.destroy(); return; }
            send(res, 500, errorResponse('INTERNAL_ERROR', 'HTTP 处理失败，请查看本地服务日志'));
            console.error('HTTP 处理失败：' + error.message);
        });
    });
    server.maxConnections = 64;
    server.maxRequestsPerSocket = 100;
    server.setTimeout(30000, socket => socket.destroy());
    async function handle(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        const reject = (status, code, message) => {
            // 提前拒绝时可能尚未收完声明的请求体，禁止在该连接上继续解析下一次请求。
            res.setHeader('Connection', 'close'); req.resume(); send(res, status, errorResponse(code, message));
        };
        for (const name of ['host', 'authorization', 'origin']) {
            if (req.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length > 1) return reject(400, 'INVALID_REQUEST', '重复的安全头');
        }
        const port = server.address()?.port ?? req.socket.localPort;
        if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return reject(403, 'HOST_FORBIDDEN', 'Host 不属于当前本机服务');
        // 本轮供原生 Agent 使用，不授权浏览器来源；无 Origin 的客户端仍须认证。
        if (req.headers.origin !== undefined) return reject(403, 'ORIGIN_FORBIDDEN', '当前服务不接受浏览器 Origin');
        const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.authorization || '');
        const actual = Buffer.from(match?.[1] || '');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
            res.setHeader('WWW-Authenticate', 'Bearer realm="asset-toolbox-local"');
            return reject(401, 'UNAUTHORIZED', '需要有效的本地 Bearer 令牌');
        }
        if (closing) return reject(503, 'SHUTTING_DOWN', '服务正在安全退出');
        if (req.url === '/health' && req.method === 'GET') return send(res, 200, { schema: 'asset-toolbox.response/1', ok: true, result: { applicationApi: 'asset-toolbox.application/1', mcp: Boolean(mcpHandler) } });
        const mcp = req.url === '/mcp' && mcpHandler;
        const action = /^\/api\/v1\/([a-z]+)$/.exec(req.url || '')?.[1];
        if (!mcp && (!action || !Object.hasOwn(ACTION_FIELDS, action))) return reject(404, 'NOT_FOUND', '接口不存在');
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return reject(405, 'METHOD_NOT_ALLOWED', '此接口只接受 POST'); }
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) return reject(415, 'UNSUPPORTED_MEDIA_TYPE', '需要 application/json（UTF-8）');
        if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') return reject(415, 'UNSUPPORTED_MEDIA_TYPE', '不接受压缩请求体');
        if (req.headers['content-length'] !== undefined && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length']) > MAX_BODY_BYTES)) return reject(413, 'PAYLOAD_TOO_LARGE', '请求体超过 1 MiB');
        if (mcp) { await mcpHandler(req, res); return; }
        let input;
        try { input = await readJson(req); }
        catch (error) {
            if (error.code !== 'REQUEST_ABORTED') reject(error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400, error.code || 'INVALID_REQUEST', error.message);
            return;
        }
        if (closing) return reject(503, 'SHUTTING_DOWN', '服务正在安全退出');
        const response = await respond(service, action, input);
        send(res, response.ok ? (action === 'submit' ? 202 : 200) : statusCodes[response.error.code] || 500, response);
    }
    return {
        server,
        listen: () => new Promise((resolve, reject) => {
            const error = cause => { server.removeListener('listening', ready); reject(cause); };
            const ready = () => { server.removeListener('error', error); resolve({ url: `http://127.0.0.1:${server.address().port}` }); };
            server.once('error', error); server.once('listening', ready);
            server.listen(port, '127.0.0.1');
        }),
        close() {
            stopping ||= (async () => {
                closing = true;
                const closed = new Promise(resolve => server.close(resolve));
                server.closeIdleConnections();
                try { await service.shutdown(); }
                finally { try { await closeMcp(); } finally { server.closeAllConnections(); await closed; } }
            })();
            return stopping;
        },
    };
}
module.exports = { createHttpServer, MAX_BODY_BYTES, validToken };
