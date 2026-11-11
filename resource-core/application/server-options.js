const fs = require('node:fs');
const { validToken } = require('./http');

function serverOptions(args, defaultTransport = 'stdio') {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
        const key = args[i], value = args[i + 1];
        if (!['--policy', '--transport', '--port', '--token-file'].includes(key) || !value || value.startsWith('--') || Object.hasOwn(options, key)) throw new Error('启动选项无效或重复：' + key);
        options[key] = value;
    }
    const transport = options['--transport'] || defaultTransport;
    if (!['stdio', 'http'].includes(transport) || !options['--policy']) throw new Error('需要 --policy <配置路径>；--transport 可为 stdio 或 http');
    if (transport === 'stdio' && (options['--port'] || options['--token-file'])) throw new Error('端口和令牌仅用于 HTTP 模式');
    if (transport === 'stdio') return { transport, policyFile: options['--policy'] };
    const portText = options['--port'] || '8787';
    if (!/^\d{1,5}$/.test(portText) || Number(portText) > 65535) throw new Error('端口必须为 0–65535 的整数');
    if (!options['--token-file']) throw new Error('HTTP 模式需要 --token-file <本地令牌文件>');
    const tokenFile = options['--token-file'];
    if (!fs.statSync(tokenFile).isFile() || fs.statSync(tokenFile).size > 256) throw new Error('令牌文件必须为不超过 256 字节的普通文件');
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    if (!validToken(token)) throw new Error('令牌格式无效，请用 token.js 生成随机令牌');
    return { transport, policyFile: options['--policy'], token, port: Number(portText) };
}
module.exports = { serverOptions };
