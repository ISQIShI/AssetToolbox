const fs = require('node:fs');
const path = require('node:path');
const { runTool, checkExit } = require('../process');

module.exports = {
    executableName: 'JPG-C_v4.0.21.902.exe',
    // -q 0 也可能改写元数据，直接跳过才能保留原字节。
    shouldCompress: settings => settings.jpgQuality !== 0,
    validate: data => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff,
    prepare({ executable, workDirectory }) {
        const staged = path.join(workDirectory, 'JPG-C.exe');
        fs.copyFileSync(executable, staged);
        return staged;
    },
    compress({ executable, input, workDirectory, settings }) {
        const result = runTool(executable, ['-m', '1', '-q', String(settings.jpgQuality), '-di', path.dirname(input)], workDirectory);
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
