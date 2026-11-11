const { execute } = require('../audio');
module.exports = { version: '1.0.0', resourceTypes: ['wav', 'flac', 'mp3', 'ogg'], execute, schema: { defaults: { lossyQuality: 4 }, limits: { lossyQuality: { label: '有损编码质量', min: 0, max: 10 } }, parameters: { lossyQuality: { hint: '仅 MP3/Vorbis：越高质量越好；Opus 固定 192 kb/s。无损格式不受影响。' } } } };
