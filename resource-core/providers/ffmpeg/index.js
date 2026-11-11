const path = require('node:path');
const { run } = require('./audio');
module.exports = {
    apiVersion: 2, version: '1.0.0', displayName: 'FFmpeg 9.0.2', executableName: 'ffmpeg.exe', requiredFiles: ['ffprobe.exe'],
    adapters: {
        'audio-analyze': require('./adapters/audio-analyze'),
        'audio-gain': require('./adapters/audio-gain'),
        'audio-normalize': require('./adapters/audio-normalize'),
    },
    check() {
        for (const name of ['ffmpeg', 'ffprobe']) {
            const version = run(path.join(__dirname, name + '.exe'), ['-version']).stdout;
            if (!new RegExp('^' + name + ' version 9\\.0\\.2(?:-|\\s)').test(version)) throw new Error('请安装核验过的 FFmpeg / FFprobe 9.0.2');
        }
    },
};
