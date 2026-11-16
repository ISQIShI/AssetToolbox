const path = require('node:path');
const { pathToFileURL } = require('node:url');
async function mcpAdapter() {
    try { return await import(pathToFileURL(path.resolve(__dirname, '../../agent-mcp/transports.mjs')).href); }
    catch (error) {
        if (['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw Object.assign(Error('缺少 MCP 包或 SDK；请携带 agent-mcp 并在该目录执行 npm ci --ignore-scripts'), { code: 'DEPENDENCY_MISSING' });
        throw error;
    }
}
async function startHttp(service, { port, token, mcp = false }) {
    const adapter = mcp ? (await mcpAdapter()).httpAdapter(service) : {};
    const server = require('./http').createHttpServer({ service, port, token, ...adapter });
    try {
        const { url } = await server.listen();
        return { ...server, endpoints: { apiUrl: url + '/api/v8/', healthUrl: url + '/health', mcpUrl: mcp ? url + '/mcp' : null } };
    } catch (error) { await server.close(); throw error; }
}
async function startStdio(service) { return (await mcpAdapter()).stdioAdapter(service); }
module.exports = { startHttp, startStdio };
