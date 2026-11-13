const { policyContext } = require('./context');
const { ApplicationService } = require('./service');
const { startHttp } = require('./transports');
const { serverOptions } = require('./server-options');

async function main(args) {
    const options = serverOptions(args, 'http');
    if (options.transport !== 'http') throw new Error('此入口只提供 HTTP API；stdio MCP 请使用 agent-mcp/server.mjs');
    const service = new ApplicationService(policyContext(options.policyFile, 'server'));
    const server = await startHttp(service, options);
    const stop = () => void server.close().catch(error => { console.error(error.message); process.exitCode = 1; });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    console.log(JSON.stringify({ transport: 'http', ...server.endpoints }));
}
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
