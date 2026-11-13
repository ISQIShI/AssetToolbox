const fs = require('node:fs');
async function main(args) {
    if (!args.length || args[0] === '--help') {
        console.log('用法：node cli.js <源文件夹> --pipeline <步骤数组.json> [--output <目录> | --backup <目录>] [--preview]');
        const { API, ACTION_FIELDS } = require('./application/contract');
        console.log(`统一 API ${API}：node cli.js api <${Object.keys(ACTION_FIELDS).join('|')}> <--policy 权限.json | --local> [--input <请求.json|->]`);
        console.log('服务管理：node cli.js service <status|configure|start|stop|client-config> <--local|--policy 权限.json> [--input 请求.json|-]；start 前台持有服务，Ctrl+C 安全停止。');
        return;
    }
    const options = {};
    for (let i = 1; i < args.length; i++) {
        const flag = args[i];
        if (flag === '--preview') { options.preview = true; continue; }
        if (!['--pipeline', '--output', '--backup'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('无效命令行选项：' + flag);
        const key = { '--pipeline': 'pipeline', '--output': 'outputDir', '--backup': 'backupDir' }[flag];
        if (options[key] !== undefined) throw new Error('重复选项：' + flag);
        const value = args[++i];
        options[key] = key === 'pipeline' ? JSON.parse(fs.readFileSync(value, 'utf8').replace(/^\uFEFF/, '')) : value;
    }
    if (!options.pipeline) throw new Error('必须提供 --pipeline');
    const path = require('node:path');
    const request = { mode: options.preview ? 'preview' : 'process', folder: path.resolve(args[0]), pipeline: options.pipeline };
    for (const key of ['outputDir', 'backupDir']) if (options[key]) request[key] = path.resolve(options[key]);
    return require('./application/cli').runCommand(require('./application/context').localContext(), 'submit', { request, idempotencyKey: require('node:crypto').randomUUID() });
}
if (require.main === module) {
    if (process.argv[2] === 'service') void require('./application/cli').main(['service-' + process.argv[3], ...process.argv.slice(4)]);
    else if (process.argv[2] === 'api') void require('./application/cli').main(process.argv.slice(3));
    else void main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { main };
