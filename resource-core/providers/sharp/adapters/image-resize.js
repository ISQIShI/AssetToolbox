const path = require('node:path');
const { runTool, checkExit } = require('../../../framework/process');
const { sharpModule } = require('../../../framework/dependencies/runtime');
module.exports = {
    version: '1.0.0', resourceTypes: ['png', 'jpg'],
    schema: { defaults: { jpegQuality: 90 }, limits: { jpegQuality: { label: 'JPEG 输出质量', min: 1, max: 100 } }, parameters: { jpegQuality: { hint: '仅影响 JPEG；PNG 保留透明通道。' } } },
    execute({ executable, input, output, parameters, providerOptions, resourceType, workDirectory }) {
        const result = runTool(process.execPath, [path.join(__dirname, '../worker.js'), input, output, JSON.stringify({ ...parameters, ...providerOptions, resourceType }), '--module=' + (executable || sharpModule())], workDirectory);
        checkExit(result);
        return { output, metadata: JSON.parse(result.stdout) };
    },
};
