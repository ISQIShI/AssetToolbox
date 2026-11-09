const fs = require('node:fs');
const path = require('node:path');
const { runTool, checkExit } = require('../../framework/process');
module.exports = {
    apiVersion: 1, version: '1.0.0', displayName: 'jpg-c',
    supports: [{ resourceType: 'jpg', operation: 'compress' }],
    executableName: 'JPG-C_v4.0.21.902.exe', schema: require('./schema'),
    prepare({ executable, workDirectory }) {
        const staged = path.join(workDirectory, 'JPG-C.exe');
        fs.copyFileSync(executable, staged);
        return staged;
    },
    execute({ executable, input, workDirectory, providerOptions }) {
        if (providerOptions.quality === 0) return { skipped: true };
        const result = runTool(executable, ['-m', '1', '-q', String(providerOptions.quality), '-di', path.dirname(input)], workDirectory);
        // JPG-C 失败也会返回 0，错误日志写在 EXE 所在目录。
        const messages = [];
        for (const name of fs.readdirSync(workDirectory)) {
            if (/^Jpg-C_.*\.log$/i.test(name)) {
                const file = path.join(workDirectory, name);
                messages.push(fs.readFileSync(file, 'utf8').trim());
                fs.unlinkSync(file);
            }
        }
        const errors = messages.filter(Boolean).join('\n');
        if (errors) throw new Error(errors);
        checkExit(result);
        return { output: input };
    },
};
