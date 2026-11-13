import contexts from '../resource-core/application/context.js';
import application from '../resource-core/application/service.js';
import optionModule from '../resource-core/application/server-options.js';
import transports from '../resource-core/application/transports.js';

const options = optionModule.serverOptions(process.argv.slice(2));
const service = new application.ApplicationService(contexts.policyContext(options.policyFile, options.transport === 'http' ? 'server' : 'connection'));
console.log = (...items) => console.error(...items);
const transport = options.transport === 'stdio' ? await transports.startStdio(service) : await transports.startHttp(service, { ...options, mcp: true });
if (options.transport === 'stdio') process.stdin.on('end', () => void stop());
else console.error(JSON.stringify({ transport: 'http', ...transport.endpoints }));
let stopping;
function stop() {
    stopping ||= transport.close().catch(error => { console.error(error.message); process.exitCode = 1; });
    return stopping;
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
