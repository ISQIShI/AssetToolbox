// MCP 协议适配器：业务与服务生命周期由核心统一管理。
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createServer } from './tools.mjs';
import http from '../resource-core/application/http.js';
export function httpAdapter(service) {
    const handler = createMcpHandler(() => createServer(service, 'http'), {
        legacy: 'stateless', maxRequestBodySize: http.MAX_BODY_BYTES, maxSubscriptions: 16,
        onerror: error => console.error(error.message),
    });
    return { mcpHandler: toNodeHandler(handler, { maxRequestBodySize: http.MAX_BODY_BYTES, onerror: error => console.error(error.message) }), closeMcp: () => handler.close() };
}
export function stdioAdapter(service) {
    const handle = serveStdio(() => createServer(service), { onerror: error => console.error(error.message) });
    return { close: async () => { await service.disconnect(); await handle.close(); } };
}
