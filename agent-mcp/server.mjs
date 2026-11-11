import { serveStdio } from '@modelcontextprotocol/server/stdio';
import contexts from '../resource-core/application/context.js';
import application from '../resource-core/application/service.js';
import optionModule from '../resource-core/application/server-options.js';
import { createServer } from './tools.mjs';

const options = optionModule.serverOptions(process.argv.slice(2));
const service = new application.ApplicationService(contexts.policyContext(options.policyFile, options.transport === 'http' ? 'server' : 'connection'));
console.log = (...items) => console.error(...items);
let closeTransport;
if (options.transport === 'stdio') {
    const handle = serveStdio(() => createServer(service), { onerror: error => console.error(error.message) });
    closeTransport = async () => { await service.disconnect(); await handle.close(); };
    process.stdin.on('end', () => void stop());
} else {
    // 按需加载 HTTP 适配器，stdio 启动方式及协议保持不变。
    const { createMcpHandler } = await import('@modelcontextprotocol/server');
    const { toNodeHandler } = await import('@modelcontextprotocol/node');
    const { default: httpModule } = await import('../resource-core/application/http.js');
    const handler = createMcpHandler(() => createServer(service, 'http'), {
        legacy: 'stateless', maxRequestBodySize: httpModule.MAX_BODY_BYTES, maxSubscriptions: 16,
        onerror: error => console.error(error.message),
    });
    const server = httpModule.createHttpServer({ ...options, service,
        mcpHandler: toNodeHandler(handler, { maxRequestBodySize: httpModule.MAX_BODY_BYTES, onerror: error => console.error(error.message) }),
        closeMcp: () => handler.close(),
    });
    closeTransport = () => server.close();
    try {
        const { url } = await server.listen();
        console.error(JSON.stringify({ transport: 'http', apiUrl: url + '/api/v2/', mcpUrl: url + '/mcp' }));
    } catch (error) { await server.close(); throw error; }
}
let stopping;
function stop() {
    stopping ||= closeTransport().catch(error => { console.error(error.message); process.exitCode = 1; });
    return stopping;
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
