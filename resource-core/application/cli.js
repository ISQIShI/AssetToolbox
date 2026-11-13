const fs = require('node:fs');
const { ApplicationService, respond } = require('./service');
const { policyContext, localContext } = require('./context');
const { RESPONSE } = require('./contract');

async function runCommand(context, action, input) {
    const service = new ApplicationService(context);
    // API 和快捷 CLI 共用这里，扩展加载时的日志也不能混入 JSON stdout。
    const log = console.log;
    console.log = (...items) => console.error(...items);
    const stop = () => void service.disconnect();
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    try {
        const response = await respond(service, action, input);
        if (action === 'submit' && response.ok) {
            const receipt = response.result;
            console.error(JSON.stringify({ jobId: receipt.jobId, replayed: receipt.replayed }));
            let state;
            do {
                state = service.dispatch('status', { jobId: receipt.jobId });
                if (!state.done) await new Promise(resolve => setTimeout(resolve, 100));
            } while (!state.done);
            response.result = { ...receipt, state };
            process.exitCode = state.exitCode || (state.preview?.issues?.length ? 1 : 0);
        }
        if (!response.ok) process.exitCode = 1;
        process.stdout.write(JSON.stringify(response).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '\n');
        // 启动命令持有服务；其他 CLI 可以查询/停止，Ctrl+C 安全退出。
        if (action === 'service-start' && response.ok) while (service.services?.server) await new Promise(resolve => setTimeout(resolve, 100));
        return response;
    } finally {
        await service.disconnect();
        console.log = log;
        process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    }
}

async function main(args) {
    // stdout 只有一个 JSON 响应；启动回执和第三方日志写 stderr。
    const log = console.log;
    console.log = (...items) => console.error(...items);
    try {
        const [action, ...flags] = args, options = {};
        for (let i = 0; i < flags.length; i += 2) {
            if (flags[i] === '--local' && !options['--local']) { options['--local'] = true; i--; continue; }
            if (!['--policy', '--input'].includes(flags[i]) || !flags[i + 1] || Object.hasOwn(options, flags[i])) throw new Error('用法：node cli.js api <action> --policy <权限.json> [--input <请求.json|->]');
            options[flags[i]] = flags[i + 1];
        }
        if (Boolean(options['--policy']) === Boolean(options['--local'])) throw new Error('指定 --policy <配置> 或显式 --local，不能同时使用');
        const context = options['--local'] ? localContext() : policyContext(options['--policy']);
        const input = options['--input'] ? JSON.parse(fs.readFileSync(options['--input'] === '-' ? 0 : options['--input'], 'utf8').replace(/^\uFEFF/, '')) : {};
        await runCommand(context, action, input);
    } catch (error) {
        process.stdout.write(JSON.stringify({ schema: RESPONSE, ok: false, error: { code: error.code || 'INVALID_REQUEST', message: error.message } }) + '\n');
        process.exitCode = 1;
    } finally {
        console.log = log;
    }
}
module.exports = { main, runCommand };
