const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { propertyCatalog, resourceTypes } = require('../framework/registry');
const { fixture } = require('./fixtures/application');

function streaminfo(samples, rate = 48000, channels = 2) {
    const header = Buffer.alloc(42);
    header.write('fLaC');
    header[4] = 0x80;
    header.writeUIntBE(34, 5, 3);
    header.writeUInt16BE(4096, 8);
    header.writeUInt16BE(4096, 10);
    const format = (BigInt(rate) << 44n) | (BigInt(channels - 1) << 41n) | (15n << 36n) | BigInt(samples);
    header.writeBigUInt64BE(format, 18);
    return header;
}

const fromBuffer = buffer => propertyCatalog.context({ buffer, resourceType: resourceTypes.get('flac') });
const expression = (property, operator, value) => ({ schema: 'asset-toolbox.filter/1', any: [{ all: [{ property, operator, value }] }] });

test('FLAC 属性使用完整 36 位采样数和声道帧单位，未知时长仍可读取采样率和声道', () => {
    const samples = 2 ** 32 + 24000;
    const get = fromBuffer(streaminfo(samples, 96000, 8));
    assert.equal(get('audio-duration'), samples / 96000);
    assert.equal(get('audio-sample-rate'), 96000);
    assert.equal(get('audio-channels'), 8);
    const unknown = fromBuffer(streaminfo(0));
    assert.equal(unknown('audio-channels'), 2);
    assert.throws(() => unknown('audio-duration'), /音频时长/);
    assert.equal(unknown('audio-sample-rate'), 48000);
});

test('FLAC 拒绝截断、伪签名、非 STREAMINFO 首块和无效音频参数', () => {
    const truncated = streaminfo(100).subarray(0, 41);
    assert.throws(() => fromBuffer(truncated)('audio-duration'), /FLAC/);
    for (const corrupt of [
        header => { header[0] |= 0x80; }, // 伪签名在 ASCII 转码时会丢失高位。
        header => { header[4] = 1; },
        header => { header[7] = 33; },
        header => header.writeUInt16BE(15, 8),
        header => header.writeUInt16BE(256, 10),
        header => header.fill(0, 18, 21), // 采样率为 0。
        header => header.writeUInt16BE(0, 20), // 位深为 1。
    ]) {
        const header = streaminfo(100);
        corrupt(header);
        assert.throws(() => fromBuffer(header)('audio-duration'), /FLAC/);
    }
});

test('混合来源在固定清单前按音频属性筛选，未知时长报错且不产生输出', async t => {
    const f = fixture(t, {}, 0);
    fs.writeFileSync(path.join(f.source, 'music.flac'), streaminfo(24000));
    fs.writeFileSync(path.join(f.source, 'stream.flac'), streaminfo(0, 44100, 1));
    fs.writeFileSync(path.join(f.source, 'sound.mp3'), '此格式不使用 audio 属性读取器');
    const request = { ...f.request, pipeline: [], sourceFilter: expression('audio-channels', 'ne', 1) };
    const preview = await f.until(f.service.submit({ ...request, mode: 'preview' }, 'audio-preview').jobId);
    assert.equal(preview.exitCode, 0);
    assert.equal(preview.preview.discovered, 3);
    assert.equal(preview.preview.filteredOut, 2);
    assert.equal(preview.preview.total, 1);
    const invalid = await f.until(f.service.submit({ ...request, sourceFilter: expression('audio-duration', 'lt', 1) }, 'unknown-duration').jobId);
    assert.equal(invalid.exitCode, 1);
    assert.match(invalid.error, /stream\.flac.*音频时长/);
    assert.equal(fs.existsSync(f.output), false);
    const result = await f.until(f.service.submit(request, 'audio-process').jobId);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(fs.readdirSync(f.output), ['music.flac']);
    assert.deepEqual(fs.readFileSync(path.join(f.output, 'music.flac')), streaminfo(24000));
});
