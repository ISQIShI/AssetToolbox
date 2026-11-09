const { runTool, checkExit } = require('../../framework/process');

function validate(data) {
    let offset = 0;
    if (data.length >= 10 && data.toString('ascii', 0, 3) === 'ID3') {
        if (data.subarray(6, 10).some(byte => byte >= 128)) return false;
        const size = data[6] * 2097152 + data[7] * 16384 + data[8] * 128 + data[9];
        offset = 10 + size;
    }
    for (let i = offset; i + 3 < Math.min(data.length, offset + 4096); i++) {
        if (data[i] === 0xff && (data[i + 1] & 0xe0) === 0xe0 &&
            (data[i + 1] & 0x18) !== 0x08 && (data[i + 1] & 0x06) === 0x02 &&
            (data[i + 2] & 0xf0) !== 0xf0 && (data[i + 2] & 0x0c) !== 0x0c) return true;
    }
    return false;
}

module.exports = {
    executableName: 'lame.exe',
    validate,
    compress({ executable, input, output, workDirectory, settings }) {
        const result = runTool(executable, ['-h', '--abr', String(settings.mp3Bitrate), '--mp3input', input, output], workDirectory);
        checkExit(result);
        return { output };
    },
};
