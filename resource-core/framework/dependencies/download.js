const https = require('node:https');
const crypto = require('node:crypto');

const MAX_DOWNLOAD = 64 * 1024 * 1024;
function validateUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || !['registry.npmjs.org', 'www.rarewares.org'].includes(url.hostname)) throw new Error('下载来源不在核验范围内');
    return url;
}
function response(url, signal) {
    return new Promise((resolve, reject) => {
        const request = https.get(url, { signal, rejectUnauthorized: true, headers: { 'User-Agent': 'AssetToolbox/1.0', 'Accept-Encoding': 'identity' } }, resolve);
        request.on('error', reject);
    });
}
async function download(artifact, { signal, getResponse = response, maxBytes = MAX_DOWNLOAD } = {}) {
    const url = validateUrl(artifact.url);
    const match = /^(sha256|sha512)-([A-Za-z0-9+/]+={0,2})$/.exec(artifact.integrity || '');
    if (!match || Buffer.from(match[2], 'base64').length !== (match[1] === 'sha256' ? 32 : 64)) throw new Error('缺少有效的下载摘要');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('下载超时，请稍后重试')), 60000);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let stream;
    try {
        combined.throwIfAborted();
        stream = await getResponse(url, combined);
        if (stream.statusCode !== 200) throw new Error(`下载失败（HTTP ${stream.statusCode}）；不接受重定向，请更新核验清单或使用手动渠道。`);
        if (stream.headers['content-encoding'] && stream.headers['content-encoding'] !== 'identity') throw new Error('下载编码不受支持');
        if (Number(stream.headers['content-length']) > maxBytes) throw new Error('下载超过大小上限');
        const chunks = [], digest = crypto.createHash(match[1]);
        let size = 0;
        for await (const chunk of stream) {
            combined.throwIfAborted();
            size += chunk.length;
            if (size > maxBytes) throw new Error('下载超过大小上限');
            digest.update(chunk); chunks.push(chunk);
        }
        combined.throwIfAborted();
        if (digest.digest('base64') !== match[2]) throw new Error('下载完整性校验失败，未安装；请勿使用此文件。');
        return Buffer.concat(chunks);
    } finally { clearTimeout(timeout); stream?.destroy(); }
}
module.exports = { download, validateUrl };
