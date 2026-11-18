// 原生 FLAC 的首个元数据块固定为 STREAMINFO，位布局见 RFC 9639 §8.2。
function readFlac({ readPrefix }) {
    const header = readPrefix(42);
    if (header.length !== 42 || header.toString('latin1', 0, 4) !== 'fLaC'
        || (header[4] & 0x7f) !== 0 || header.readUIntBE(5, 3) !== 34) {
        throw Error('FLAC 缺少完整的 STREAMINFO 文件头');
    }
    const minBlock = header.readUInt16BE(8);
    const maxBlock = header.readUInt16BE(10);
    const minFrame = header.readUIntBE(12, 3);
    const maxFrame = header.readUIntBE(15, 3);
    const sampleRate = header.readUIntBE(18, 3) >>> 4;
    const channels = ((header[20] >>> 1) & 7) + 1;
    const bits = ((header.readUInt16BE(20) >>> 4) & 31) + 1;
    if (sampleRate === 0 || bits < 4 || minBlock < 16 || maxBlock < minBlock || (maxFrame && minFrame > maxFrame)) {
        throw Error('FLAC STREAMINFO 音频参数无效');
    }
    const samples = (header[21] & 15) * 2 ** 32 + header.readUInt32BE(22);
    return { sampleRate, channels, duration: samples ? samples / sampleRate : undefined };
}

module.exports = { readFlac };
