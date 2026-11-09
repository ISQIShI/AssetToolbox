const fs = require('node:fs');
const path = require('node:path');
const { runTool, checkExit } = require('../../framework/process');
module.exports = {
    apiVersion: 1, version: '1.0.0', displayName: 'lame',
    supports: [{ resourceType: 'mp3', operation: 'compress' }],
    executableName: 'lame.exe', schema: require('./schema'),
    execute({ executable, input, output, workDirectory, providerOptions }) {
        const result = runTool(executable, ['-h', '--abr', String(providerOptions.bitrate), '--mp3input', input, output], workDirectory);
        checkExit(result);
        return { output };
    },
};
