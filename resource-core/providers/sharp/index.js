const path = require('node:path');
const { runTool, checkExit } = require('../../framework/process');
const { sharpModule } = require('../../framework/dependencies/runtime');
module.exports = {
    apiVersion: 2, version: '2.0.0', displayName: 'Sharp / libvips',
    adapters: { 'image-resize': require('./adapters/image-resize') },
    check() { checkExit(runTool(process.execPath, [path.join(__dirname, 'worker.js'), '--check', '--module=' + sharpModule()], __dirname)); },
    prepare() { return sharpModule(); },
};
