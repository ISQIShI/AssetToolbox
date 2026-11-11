const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
// 仅管理已由应用服务校验并落盘的作业进程，不定义第二套业务请求。
class JobSession {
    constructor() { this.job = null; this.closing = false; }
    start(request, persistent) {
        if (this.closing) throw new Error('应用正在退出');
        if (this.job && !this.job.exited) throw new Error('请等待当前任务结束');
        this.cleanup();
        const { directory, id } = persistent;
        const job = { id, directory, exited: false, state: { phase: 'starting', done: false, processed: 0, total: 0 }, stderr: '' };
        try {
            const filename = path.join(directory, 'request.json');
            fs.writeFileSync(filename, JSON.stringify(request), { flag: 'wx' });
            job.child = spawn(process.execPath, [path.join(__dirname, '..', request.mode === 'dependency-install' ? 'framework/dependencies/worker.js' : 'batch.js'), filename], {
                cwd: path.join(__dirname, '..'), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
            });
            this.job = job;
            fs.writeFileSync(path.join(directory, 'worker.json'), JSON.stringify({ pid: job.child.pid }));
            job.child.stderr.on('data', data => { job.stderr = (job.stderr + data.toString()).slice(-8000); });
            job.completion = new Promise(resolve => {
                job.child.on('error', error => { job.error = error.message; });
                job.child.once('close', code => {
                    job.exited = true; job.code = code;
                    try { fs.writeFileSync(path.join(directory, 'exit.json'), JSON.stringify({ code, error: job.error || job.stderr }), { flag: 'wx' }); }
                    catch (error) { job.error = error.message; }
                    resolve();
                });
            });
            return { id: job.id };
        } catch (error) {
            throw error;
        }
    }
    current(id) {
        if (!this.job || this.job.id !== id) throw new Error('任务会话已失效，请从任务历史继续');
        return this.job;
    }
    poll(id) {
        const job = this.current(id);
        try { job.state = JSON.parse(fs.readFileSync(path.join(job.directory, 'status.json'), 'utf8')); }
        catch (error) { if (!['ENOENT', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code)) job.error = error.message; }
        // 必须等待进程退出和锁释放后才允许启动下一项任务。
        if (!job.exited) return { ...job.state, done: false };
        if (!job.state.done) return { ...job.state, done: true, phase: 'finished', exitCode: 1, errorCode: 'INTERRUPTED',
            error: job.error || job.stderr || `工作进程意外退出（${job.code}），可从任务历史继续未完成文件。` };
        return job.state;
    }
    cancel(id) {
        const job = this.current(id);
        if (!job.exited) fs.writeFileSync(path.join(job.directory, 'cancel'), '');
        return { requested: true };
    }
    cleanup() {
        if (this.job?.exited) this.job = null;
    }
    async shutdown() {
        this.closing = true;
        if (this.job && !this.job.exited) { this.cancel(this.job.id); await this.job.completion; }
        this.cleanup();
    }
}
module.exports = { JobSession };
