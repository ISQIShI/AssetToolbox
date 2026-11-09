const fs = require('node:fs');
const path = require('node:path');
const { runTool, checkExit } = require('../../framework/process');
module.exports = {
    apiVersion: 1, version: '2.0.0', displayName: 'LAME 4.0',
    supports: [{ resourceType: 'mp3', operation: 'compress' }],
    executableName: 'lame.exe', schema: require('./schema'),
    requiredFiles: ['libmpg123-0.dll'],
    execute({ executable, input, output, workDirectory, providerOptions }) {
        const result = runTool(executable, ['-h', '--abr', String(providerOptions.bitrate), '--mp3input', input, output], workDirectory);
        checkExit(result);
        return { output };
    },
};
