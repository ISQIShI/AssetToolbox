const fs = require('node:fs');
const path = require('node:path');
module.exports = {
    apiVersion: 2, version: '2.0.0', displayName: 'jpg-c',
    adapters: { 'compress': require('./adapters/compress') },
    executableName: 'JPG-C_v4.0.21.902.exe',
    prepare({ executable, workDirectory }) {
        const staged = path.join(workDirectory, 'JPG-C.exe');
        fs.copyFileSync(executable, staged);
        return staged;
    },
};
