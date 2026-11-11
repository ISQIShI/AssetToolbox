// 桌面 JSON Lines 传输适配；业务服务集中在 application/。
const { ApplicationService, ACTION_FIELDS, capabilities, respond } = require('./application/service');
const { RESPONSE } = require('./application/contract');
const { dispatchDesktop } = require('./application/desktop-actions');
class DesktopBridge {
    constructor(context) { this.application = context ? new ApplicationService(context) : ApplicationService.forDesktop(); }
    async dispatch(action, payload = {}) {
        return Object.hasOwn(ACTION_FIELDS, action) ? this.application.dispatch(action, payload) : dispatchDesktop(this.application, action, payload, capabilities);
    }
    shutdown() { return this.application.disconnect(); }
}

if (require.main === module) {
    const bridge = new DesktopBridge();
    const input = require('node:readline').createInterface({ input: process.stdin, crlfDelay: Infinity });
    // 模块自己的日志写入 stderr，不能破坏 JSON 协议。
    console.log = (...args) => console.error(...args);
    input.on('line', async line => {
        let message;
        try {
            message = JSON.parse(line);
            const response = await respond(bridge, message.action, message.payload);
            process.stdout.write(JSON.stringify({ id: message.id, ...response }) + '\n');
        } catch (error) { process.stdout.write(JSON.stringify({ id: message?.id, schema: RESPONSE, ok: false, error: { code: 'INVALID_REQUEST', message: error.message } }) + '\n'); }
    });
    let stopping = false;
    const stop = async () => {
        if (stopping) return; stopping = true;
        await bridge.shutdown(); process.exit(0);
    };
    input.on('close', stop);
    process.on('SIGTERM', stop);
    // 宿主崩溃时 stdin 通常关闭；额外检查父进程，避免失联后继续处理整批素材。
    const parent = process.ppid;
    setInterval(() => { try { process.kill(parent, 0); } catch { void stop(); } }, 1500).unref();
}
module.exports = { DesktopBridge };
