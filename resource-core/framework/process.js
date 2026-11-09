const childProcess = require('node:child_process');

function runTool(executable, args, cwd) {
    const result = childProcess.spawnSync(executable, args, { cwd, windowsHide: true, encoding: 'utf8' });
    if (result.error) throw result.error;
    if (result.signal || result.status === null) throw new Error(`处理进程中断：${result.signal || '未知原因'}`);
    return result;
}

function checkExit(result) {
    if (result.status !== 0) throw new Error(`处理工具退出码 ${result.status}：${(result.stderr || result.stdout || '').trim()}`);
}

module.exports = { runTool, checkExit };
