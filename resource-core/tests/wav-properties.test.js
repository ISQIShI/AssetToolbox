const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readWav } = require('../properties/audio/wav');

function header(id, length) {
    const bytes = Buffer.alloc(8);
    bytes.write(id);
    bytes.writeUInt32LE(length, 4);
    return bytes;
}

function chunk(id, data) {
    return Buffer.concat([header(id, data.length), data, Buffer.alloc(data.length % 2)]);
}

function format({ tag = 1, channels = 2, rate = 48000, bits = 16, extensible = false, validBits = bits } = {}) {
    const result = Buffer.alloc(extensible ? 40 : 16);
    const align = channels * bits / 8;
    result.writeUInt16LE(extensible ? 0xfffe : tag, 0);
    result.writeUInt16LE(channels, 2);
    result.writeUInt32LE(rate, 4);
    result.writeUInt32LE(rate * align, 8);
    result.writeUInt16LE(align, 12);
    result.writeUInt16LE(bits, 14);
    if (extensible) {
        result.writeUInt16LE(22, 16);
        result.writeUInt16LE(validBits, 18);
        result.writeUInt32LE(tag, 24);
        Buffer.from('00001000800000aa00389b71', 'hex').copy(result, 28);
    }
    return result;
}

function riff(...chunks) {
    const content = Buffer.concat([Buffer.from('WAVE'), ...chunks]);
    return Buffer.concat([header('RIFF', content.length), content]);
}

const data = size => chunk('data', Buffer.alloc(size));
const parse = (bytes, size = bytes.length) => readWav({ size, readRange: (start, length) => bytes.subarray(start, start + length) });

test('WAV 依据声道帧数读取 PCM、浮点及 extensible 的时长，元数据与奇数字节填充不计入', () => {
    for (const settings of [
        { tag: 1, bits: 8, channels: 1 },
        { tag: 3, bits: 32, channels: 2 },
        { tag: 1, bits: 24, channels: 6, extensible: true, validBits: 20 },
        { tag: 3, bits: 64, channels: 2, extensible: true },
    ]) {
        const frames = 15;
        const bytes = riff(chunk('JUNK', Buffer.alloc(3)), chunk('fmt ', format(settings)),
            data(frames * settings.channels * settings.bits / 8), chunk('LIST', Buffer.from('INFO')));
        assert.deepEqual(parse(bytes), { sampleRate: 48000, channels: settings.channels, duration: frames / 48000 });
    }
    assert.equal(parse(riff(chunk('fmt ', format()), data(0))).duration, 0);
});

test('WAV 拒绝截断、越界、不完整帧及含歧义的数据块', () => {
    const fmt = chunk('fmt ', format());
    const valid = riff(fmt, data(8));
    assert.throws(() => parse(Buffer.alloc(0)), /文件头/);
    assert.throws(() => parse(valid.subarray(0, -1)), /容器长度/);
    assert.throws(() => parse(fmt), /容器头/);
    assert.throws(() => parse(riff(fmt, data(2))), /完整音频帧/);
    assert.throws(() => parse(riff(fmt, header('JUNK', 1), Buffer.alloc(1))), /填充/);
    assert.throws(() => parse(riff(fmt, Buffer.from('chunk'))), /块头/);
    assert.throws(() => parse(riff(fmt, header('data', 8))), /容器范围/);
    assert.throws(() => parse(riff(fmt)), /缺少音频/);
    assert.throws(() => parse(riff(data(0), fmt)), /fmt 后/);
    assert.throws(() => parse(riff(fmt, data(0), data(4))), /单一 data/);
    assert.throws(() => parse(riff(fmt, fmt, data(0))), /多个 fmt/);
    assert.throws(() => parse(riff(fmt, data(4), chunk('LIST', Buffer.from('wavl')))), /分段/);
    assert.throws(() => parse(riff(fmt, ...Array.from({ length: 256 }, () => chunk('JUNK', Buffer.alloc(0))), data(4))), /256/);
    assert.throws(() => parse(valid.subarray(0, 21), valid.length), /读取不完整/);
});

test('WAV 拒绝无效格式声明与压缩编码，不能按固定帧推算其时长', () => {
    const check = (fmt, error) => assert.throws(() => parse(riff(chunk('fmt ', fmt), data(0))), error);
    check(format({ tag: 0x11 }), /仅支持/);
    check(format({ tag: 3, bits: 24 }), /采样格式/);
    check(format({ channels: 0 }), /采样格式/);
    check(format({ rate: 0 }), /采样格式/);
    check(format({ extensible: true, validBits: 17 }), /有效位深/);
    check(format({ extensible: true }).subarray(0, 16), /扩展格式/);
    check(format().subarray(0, 12), /fmt 块/);
    const wrongRate = format();
    wrongRate.writeUInt32LE(16, 8);
    check(wrongRate, /字节速率/);
    const wrongAlign = format();
    wrongAlign.writeUInt16LE(1, 12);
    check(wrongAlign, /帧对齐/);
    const wrongSubformat = format({ extensible: true });
    wrongSubformat[39] ^= 0x80;
    check(wrongSubformat, /扩展编码/);
    const badExtension = format({ extensible: true });
    badExtension.writeUInt16LE(30, 16);
    check(badExtension, /fmt 块/);
});

test('仅定位普通 WAV 的大块及 RF64 超过 4 GiB 的数据，读取量与音频长度无关', () => {
    const fmt = chunk('fmt ', format());
    const junkSize = 512 * 1024 * 1024;
    const largeRiffSize = 4 + 8 + junkSize + fmt.length + 8 + 16;
    const beforeJunk = Buffer.concat([header('RIFF', largeRiffSize), Buffer.from('WAVE'), header('JUNK', junkSize)]);
    const afterJunk = Buffer.concat([fmt, header('data', 16)]);
    let bytesRead = 0;
    const result = readWav({
        size: largeRiffSize + 8,
        readRange(offset, length) {
            bytesRead += length;
            if (offset + length <= beforeJunk.length) return beforeJunk.subarray(offset, offset + length);
            const local = offset - beforeJunk.length - junkSize;
            assert.ok(local >= 0 && local + length <= afterJunk.length, '不得读取 JUNK 或音频内容');
            return afterJunk.subarray(local, local + length);
        },
    });
    assert.equal(result.duration, 4 / 48000);
    assert.ok(bytesRead <= 64);

    const dataSize = 2 ** 32 + 4;
    const sizes = Buffer.alloc(28);
    const prefixSize = 12 + 8 + sizes.length + fmt.length + 8;
    sizes.writeBigUInt64LE(BigInt(prefixSize + dataSize - 8), 0);
    sizes.writeBigUInt64LE(BigInt(dataSize), 8);
    sizes.writeBigUInt64LE(BigInt(dataSize / 4), 16);
    const rf64 = () => Buffer.concat([header('RF64', 0xffffffff), Buffer.from('WAVE'), chunk('ds64', sizes), fmt, header('data', 0xffffffff)]);
    // 除前缀外没有分配数据区。若读取音频内容，读取长度核验必定失败。
    assert.deepEqual(parse(rf64(), prefixSize + dataSize), { channels: 2, sampleRate: 48000, duration: dataSize / 4 / 48000 });
    sizes.writeBigUInt64LE(1n, 16);
    assert.throws(() => parse(rf64(), prefixSize + dataSize), /样本数/);
    sizes.writeUInt32LE(1, 24);
    assert.throws(() => parse(rf64(), prefixSize + dataSize), /长度表/);
    sizes.writeUInt32LE(0, 24);
    sizes.writeBigUInt64LE(1n << 60n, 0);
    assert.throws(() => parse(rf64(), prefixSize + dataSize), /安全整数/);
});
