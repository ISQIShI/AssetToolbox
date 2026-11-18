// PCM 与 IEEE 浮点的每帧字节数固定，只需访问 RIFF 块头和格式字段。
const extensibleGuidTail = Buffer.from('00001000800000aa00389b71', 'hex');
const maxChunks = 256;
const sizePlaceholder = 0xffffffff;

function readFormat(bytes, length) {
    if (length < 16 || length === 17 || (length >= 18 && bytes.readUInt16LE(16) > length - 18)) {
        throw Error('WAV fmt 块不完整');
    }
    let tag = bytes.readUInt16LE(0);
    const channels = bytes.readUInt16LE(2);
    const sampleRate = bytes.readUInt32LE(4);
    const byteRate = bytes.readUInt32LE(8);
    const frameSize = bytes.readUInt16LE(12);
    const bits = bytes.readUInt16LE(14);
    if (tag === 0xfffe) {
        if (length < 40 || bytes.readUInt16LE(16) < 22) throw Error('WAV 扩展格式不完整');
        if (!bytes.subarray(28, 40).equals(extensibleGuidTail)) throw Error('不支持此 WAV 扩展编码');
        tag = bytes.readUInt32LE(24);
        const validBits = bytes.readUInt16LE(18);
        if (!validBits || validBits > bits || (tag === 3 && bits !== validBits)) throw Error('WAV 有效位深无效');
    }
    if (tag !== 1 && tag !== 3) throw Error('WAV 属性仅支持 PCM 与 IEEE 浮点');
    if (!channels || !sampleRate || !bits || bits % 8 || (tag === 3 && bits !== 32 && bits !== 64)
        || frameSize !== channels * (bits / 8) || byteRate !== frameSize * sampleRate) {
        throw Error('WAV 采样格式、字节速率或帧对齐无效');
    }
    return { channels, sampleRate, frameSize };
}

function readWav({ readRange, size }) {
    if (!Number.isSafeInteger(size) || size < 12) throw Error('WAV 文件头不完整');
    function read(offset, length) {
        if (length > size - offset) throw Error('WAV 块超出文件范围');
        const bytes = readRange(offset, length);
        if (bytes.length !== length) throw Error('WAV 块读取不完整');
        return bytes;
    }
    const header = read(0, 12);
    const container = header.toString('latin1', 0, 4);
    if (!['RIFF', 'RF64'].includes(container) || header.toString('latin1', 8, 12) !== 'WAVE') {
        throw Error('WAV 容器头无效');
    }
    let riffSize = header.readUInt32LE(4);
    let offset = 12;
    let rf64DataSize, rf64Frames;
    if (container === 'RF64') {
        const first = read(offset, 8);
        const chunkSize = first.readUInt32LE(4);
        if (riffSize !== sizePlaceholder || first.toString('latin1', 0, 4) !== 'ds64' || chunkSize < 28) {
            throw Error('RF64 缺少有效的 ds64 块');
        }
        const sizes = read(offset + 8, 28);
        if (sizes.readUInt32LE(24) !== 0) throw Error('暂不支持含额外超大块长度表的 RF64');
        riffSize = Number(sizes.readBigUInt64LE(0));
        rf64DataSize = Number(sizes.readBigUInt64LE(8));
        rf64Frames = Number(sizes.readBigUInt64LE(16));
        if (![riffSize, rf64DataSize, rf64Frames].every(Number.isSafeInteger)) throw Error('RF64 声明超出安全整数范围');
        offset += 8 + chunkSize + chunkSize % 2;
    }
    if (riffSize > size - 8 || riffSize < offset - 8) throw Error('WAV 容器长度与文件不符');
    const end = riffSize + 8;
    let format, dataSize, chunks = 0;
    while (offset < end) {
        if (++chunks > maxChunks) throw Error('WAV 块数超过 256 项上限');
        if (end - offset < 8) throw Error('WAV 块头不完整');
        const chunk = read(offset, 8);
        const id = chunk.toString('latin1', 0, 4);
        let length = chunk.readUInt32LE(4);
        if (container === 'RF64' && id === 'data') {
            if (length !== sizePlaceholder) throw Error('RF64 data 块缺少长度占位符');
            length = rf64DataSize;
        }
        offset += 8;
        if (length + length % 2 > end - offset) throw Error('WAV 块超出容器范围或缺少填充');
        if (id === 'fmt ') {
            if (format) throw Error('WAV 含多个 fmt 块');
            format = readFormat(read(offset, Math.min(40, length)), length);
        } else if (id === 'data') {
            if (!format || dataSize !== undefined) throw Error('WAV 需要在 fmt 后包含单一 data 块');
            dataSize = length;
        } else if (id === 'LIST') {
            if (length < 4) throw Error('WAV LIST 类型不完整');
            if (read(offset, 4).toString('latin1') === 'wavl') throw Error('暂不支持分段 WAV 音频');
        } else if (id === 'ds64') {
            throw Error('WAV 含意外的 ds64 块');
        }
        offset += length + length % 2;
    }
    if (dataSize === undefined) throw Error('WAV 缺少音频 data 块');
    if (dataSize % format.frameSize) throw Error('WAV 数据结尾不是完整音频帧');
    const frames = dataSize / format.frameSize;
    if (rf64Frames && rf64Frames !== frames) throw Error('RF64 样本数与音频帧数不符');
    return { sampleRate: format.sampleRate, channels: format.channels, duration: frames / format.sampleRate };
}

module.exports = { readWav };
