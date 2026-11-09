const path = require('node:path');
const { runTool, checkExit } = require('../../framework/process');
module.exports = {
    apiVersion: 1, version: '1.0.0', displayName: 'Sharp / libvips',
    supports: [{ resourceType: 'png', operation: 'image-resize' }, { resourceType: 'jpg', operation: 'image-resize' }],
    schema: { defaults: { jpegQuality: 90 }, limits: { jpegQuality: { label: 'JPEG 输出质量', min: 1, max: 100 } }, parameters: { jpegQuality: { hint: '仅影响 JPEG；PNG 保留透明通道。' } } },
    check() { checkExit(runTool(process.execPath, [path.join(__dirname, 'worker.js'), '--check'], __dirname)); },
    execute({ input, output, parameters, providerOptions, resourceType, workDirectory }) {
        const result = runTool(process.execPath, [path.join(__dirname, 'worker.js'), input, output, JSON.stringify({ ...parameters, ...providerOptions, resourceType })], workDirectory);
        checkExit(result);
        return { output, metadata: JSON.parse(result.stdout) };
    },
};
