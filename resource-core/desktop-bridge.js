// 桌面 JSON Lines 传输适配；业务服务集中在 application/。
const { ApplicationService } = require('./application/service');
class DesktopBridge {
    constructor() { this.application = ApplicationService.forDesktop(); }
    async dispatch(action, payload = {}) { return this.application.dispatch(action, payload); }
    start(request) { return this.application.dispatch('start', request); }
    poll(id) { return this.application.dispatch('poll', { id }); }
    cancel(id) { return this.application.dispatch('cancel', { id }); }
    shutdown() { return this.application.shutdown(); }
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
            const result = await bridge.dispatch(message.action, message.payload);
            process.stdout.write(JSON.stringify({ id: message.id, result }) + '\n');
        } catch (error) { process.stdout.write(JSON.stringify({ id: message?.id, error: error.message }) + '\n'); }
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
