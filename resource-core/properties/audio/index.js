const { readFlac } = require('./flac');
const { readWav } = require('./wav');

const readers = { flac: readFlac, wav: readWav };

module.exports = {
    apiVersion: 1, version: '1.0.0', displayName: '音频属性', common: false,
    fields: {
        'audio-duration': { type: 'number', label: '音频时长', unit: 's', min: 0 },
        'audio-sample-rate': { type: 'number', label: '采样率', unit: 'Hz', min: 1 },
        'audio-channels': { type: 'number', label: '声道数', min: 1 },
    },
    read(source) {
        const { sampleRate, channels, duration } = readers[source.resourceType.id](source);
        return { 'audio-duration': duration, 'audio-sample-rate': sampleRate, 'audio-channels': channels };
    },
};
