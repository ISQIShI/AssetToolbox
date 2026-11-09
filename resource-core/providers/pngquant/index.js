const fs = require('node:fs');
const path = require('node:path');
const { runTool, checkExit } = require('../../framework/process');
module.exports = {
    apiVersion: 1, version: '1.0.0', displayName: 'pngquant',
    supports: [{ resourceType: 'png', operation: 'compress' }],
    executableName: 'pngquant.exe', schema: require('./schema'),
    execute({ executable, input, workDirectory, providerOptions }) {
        const args = ['-f', '--ext', '.png', '--speed', String(providerOptions.speed),
            '--quality', `${providerOptions.qualityMin}-${providerOptions.qualityMax}`, '--skip-if-larger', input];
        const result = runTool(executable, args, workDirectory);
        // 98: 没有变小；99: 无法满足最低质量。
        if (result.status === 98 || result.status === 99) return { skipped: true };
        checkExit(result);
        return { output: input };
    },
};
