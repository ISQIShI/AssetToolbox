const { runTool, checkExit } = require('../../../framework/process');
module.exports = {
    version: '1.0.0', resourceTypes: ['mp3'],
    schema: require('./compress-schema'),
    execute({ executable, input, output, workDirectory, providerOptions }) {
        const result = runTool(executable, ['-h', '--abr', String(providerOptions.bitrate), '--mp3input', input, output], workDirectory);
        checkExit(result);
        return { output };
    },
};
