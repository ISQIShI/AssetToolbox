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
    const mcpHandler = toNodeHandler({
        async fetch(request, options) {
            const response = await handler.fetch(request, options);
            if (response.headers.get('connection')?.toLowerCase() !== 'keep-alive') return response;
            // SSE 的连接复用交给 Node 决定，达到单连接请求上限时由它发送 close。
            const outgoing = new Response(response.body, response);
            outgoing.headers.delete('connection');
            return outgoing;
        },
    }, { maxRequestBodySize: http.MAX_BODY_BYTES, onerror: error => console.error(error.message) });
    return { mcpHandler, closeMcp: () => handler.close() };
}
export function stdioAdapter(service) {
    const handle = serveStdio(() => createServer(service), { onerror: error => console.error(error.message) });
    return { close: async () => { await service.disconnect(); await handle.close(); } };
}
