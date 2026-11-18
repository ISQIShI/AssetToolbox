const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { writeExclusive } = require('./publication');

function readWorkerStatus(directory, exited) {
    const filename = path.join(directory, 'status.json');
    for (let attempt = 0; ; attempt++) {
        try {
            const state = JSON.parse(fs.readFileSync(filename, 'utf8'));
            if (typeof state?.done !== 'boolean') throw new Error('作业状态记录缺少有效的 done 标志');
            return state;
        }
        catch (error) {
            if (error.code === 'ENOENT') return null;
            if (!['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
            if (!exited) return null;
            // Windows 临时占用可能一直持续到 worker 退出之后。只给最终读取 150 ms，
            // 持续拒绝访问时上报实际 I/O 错误，不把旧进度当作失败终态。
            if (attempt >= 6) throw error;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
        }
    }
}

// 仅管理已由应用服务校验并落盘的作业进程，不定义第二套业务请求。
class JobSession {
    constructor() { this.job = null; this.jobs = new Map(); this.closing = false; }
    start(request, persistent) {
        if (this.closing) throw new Error('应用正在退出');
        this.cleanup();
        const { directory, id } = persistent;
        const job = { id, directory, exited: false, state: { phase: 'starting', done: false, processed: 0, total: 0 }, stderr: '' };
        try {
            const filename = path.join(directory, 'request.json');
            writeExclusive(filename, request);
            job.child = spawn(process.execPath, [path.join(__dirname, '..', request.mode === 'dependency-install' ? 'framework/dependencies/worker.js' : 'batch.js'), filename], {
                cwd: path.join(__dirname, '..'), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
            });
            this.job = job; this.jobs.set(id, job);
            job.child.stderr.on('data', data => { job.stderr = (job.stderr + data.toString()).slice(-8000); });
            job.completion = new Promise(resolve => {
                job.child.on('error', error => { job.error = error.message; });
                job.child.once('close', code => {
                    job.exited = true; job.code = code;
                    try { writeExclusive(path.join(directory, 'exit.json'), { code, error: job.error || job.stderr }); }
                    catch (error) { job.error = error.message; }
                    resolve();
                });
            });
            writeExclusive(path.join(directory, 'worker.json'), { pid: job.child.pid });
            return { id: job.id };
        } catch (error) {
            throw error;
        }
    }
    current(id) {
        if (!this.jobs.has(id)) throw new Error('任务会话已失效，请从任务历史继续');
        return this.jobs.get(id);
    }
    poll(id) {
        const job = this.current(id);
        const snapshot = readWorkerStatus(job.directory, job.exited);
        if (snapshot) job.state = snapshot;
        // 必须等待进程退出和锁释放后才允许启动下一项任务。
        if (!job.exited) return { ...job.state, done: false };
        if (!snapshot?.done) return { ...job.state, done: true, phase: 'finished', exitCode: 1, errorCode: 'INTERRUPTED',
            error: job.error || job.stderr || `工作进程意外退出（${job.code}），可从任务历史继续未完成文件。` };
        return job.state;
    }
    cancel(id) {
        const job = this.current(id);
        if (!job.exited) fs.writeFileSync(path.join(job.directory, 'cancel'), '');
        return { requested: true };
    }
    cleanup() {
        for (const [id, job] of this.jobs) if (job.exited) this.jobs.delete(id);
        if (this.job?.exited) this.job = null;
    }
    async shutdown() {
        this.closing = true;
        for (const job of this.jobs.values()) if (!job.exited) this.cancel(job.id);
        await Promise.all([...this.jobs.values()].map(job => job.completion));
        this.cleanup();
    }
}
module.exports = { JobSession, readWorkerStatus };
