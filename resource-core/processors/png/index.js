const { runTool, checkExit } = require('../../framework/process');

module.exports = {
    executableName: 'pngquant.exe',
    validate: data => data.length >= 8 && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
    compress({ executable, input, workDirectory, settings }) {
        const args = ['-f', '--ext', '.png', '--speed', String(settings.pngSpeed),
            '--quality', `${settings.pngQualityMin}-${settings.pngQualityMax}`, '--skip-if-larger', input];
        const result = runTool(executable, args, workDirectory);
        // 98: 没有变小；99: 无法满足最低质量。
        if (result.status === 98 || result.status === 99) return { skipped: true };
        checkExit(result);
        return { output: input };
    },
};
