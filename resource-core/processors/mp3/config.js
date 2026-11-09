module.exports = {
    displayName: 'MP3', order: 30, extensions: ['.mp3'], enabledKey: 'mp3Enabled',
    description: 'ABR 平均码率，单位 kbps；24 kbps 会明显降低音质。',
    defaults: { mp3Enabled: false, mp3Bitrate: 24 },
    limits: { mp3Bitrate: { label: 'MP3 平均码率', min: 8, max: 320 } },
};
