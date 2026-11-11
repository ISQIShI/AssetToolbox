const fs = require('node:fs');
const path = require('node:path');
const { install } = require('./install');
async function main() {
    const filename = path.resolve(process.argv[2]), directory = path.dirname(filename);
    const { providerId } = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const { acquire, alive } = require('../../application/lock');
    const parentPid = process.ppid;
    let releaseExecution;
    const controller = new AbortController(), started = Date.now();
    const timer = setInterval(() => { if (fs.existsSync(path.join(directory, 'cancel')) || !alive(parentPid)) controller.abort(new Error('已取消安装')); }, 100);
    let state = { done: false, phase: 'starting', processed: 0, total: 0 };
    const publish = update => {
        state = { ...state, ...update, elapsedSeconds: (Date.now() - started) / 1000 };
        const temporary = path.join(directory, 'status.next');
        for (let attempt = 0; ; attempt++) {
            try { fs.writeFileSync(temporary, JSON.stringify(state)); fs.renameSync(temporary, path.join(directory, 'status.json')); break; }
            catch (error) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 8) throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); }
        }
    };
    const checkCancellation = () => { if (fs.existsSync(path.join(directory, 'cancel')) || !alive(parentPid)) controller.abort(new Error('已取消安装')); };
    try { releaseExecution = acquire(); await install(providerId, { signal: controller.signal, checkCancellation, publish }); }
    catch (error) {
        publish({ done: true, phase: 'finished', exitCode: controller.signal.aborted ? 2 : 1, cancelled: controller.signal.aborted,
            ...(controller.signal.aborted ? { message: '安装已取消，原安装保持不变。' } : { error: error.message, errorCode: error.code || 'JOB_FAILED' }) });
        process.exitCode = state.exitCode;
    } finally { clearInterval(timer); if (releaseExecution) releaseExecution(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
