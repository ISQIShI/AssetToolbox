const fs = require('node:fs');
const { ApplicationService, respond } = require('./service');

async function main(args) {
    let service;
    const stop = () => { if (service) void service.shutdown(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    // stdout 只有一个 JSON 响应；启动回执和第三方日志写 stderr。
    const log = console.log;
    console.log = (...items) => console.error(...items);
    try {
        const [action, ...flags] = args, options = {};
        for (let i = 0; i < flags.length; i += 2) {
            if (!['--policy', '--input'].includes(flags[i]) || !flags[i + 1] || Object.hasOwn(options, flags[i])) throw new Error('用法：node cli.js api <action> --policy <权限.json> [--input <请求.json|->]');
            options[flags[i]] = flags[i + 1];
        }
        if (!options['--policy']) throw new Error('必须通过 --policy 指定启动权限配置');
        service = new ApplicationService(options['--policy']);
        const input = options['--input'] ? JSON.parse(fs.readFileSync(options['--input'] === '-' ? 0 : options['--input'], 'utf8').replace(/^\uFEFF/, '')) : {};
        let response = await respond(service, action, input);
        if (action === 'submit' && response.ok) {
            const receipt = response.result;
            console.error(JSON.stringify({ jobId: receipt.jobId, replayed: receipt.replayed }));
            let state;
            do {
                state = service.status(receipt.jobId);
                if (!state.done) await new Promise(resolve => setTimeout(resolve, 100));
            } while (!state.done);
            response.result = { ...receipt, state };
            process.exitCode = state.exitCode || 0;
        }
        if (!response.ok) process.exitCode = 1;
        process.stdout.write(JSON.stringify(response) + '\n');
    } catch (error) {
        process.stdout.write(JSON.stringify({ schema: 'asset-toolbox.response/1', ok: false, error: { code: error.code || 'INVALID_REQUEST', message: error.message } }) + '\n');
        process.exitCode = 1;
    } finally {
        if (service) await service.shutdown();
        console.log = log;
        process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    }
}
module.exports = { main };
