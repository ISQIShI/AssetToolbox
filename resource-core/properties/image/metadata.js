// 只读文件头中的尺寸；不是完整解码校验。最多读取 1 MiB，由调用者提供有界前缀。
function orientation(bytes) {
    if (bytes.toString('ascii', 0, 6) !== 'Exif\0\0') return 1;
    const data = bytes.subarray(6), order = data.toString('ascii', 0, 2);
    if (data.length < 8 || !['II', 'MM'].includes(order)) throw Error('EXIF 头无效');
    const read = (offset, size) => {
        if (offset < 0 || offset + size > data.length) throw Error('EXIF 数据不完整');
        return size === 2 ? (order === 'II' ? data.readUInt16LE(offset) : data.readUInt16BE(offset))
            : (order === 'II' ? data.readUInt32LE(offset) : data.readUInt32BE(offset));
    };
    if (read(2, 2) !== 42) throw Error('EXIF 格式无效');
    const offset = read(4, 4), count = read(offset, 2);
    if (offset + 2 + count * 12 > data.length) throw Error('EXIF 条目不完整');
    for (let i = 0; i < count; i++) {
        const entry = offset + 2 + i * 12;
        if (read(entry, 2) !== 0x112) continue;
        if (read(entry + 2, 2) !== 3 || read(entry + 4, 4) !== 1) throw Error('EXIF 方向条目无效');
        const value = read(entry + 8, 2);
        if (value < 1 || value > 8) throw Error('EXIF 方向无效');
        return value;
    }
    return 1;
}
function dimensions(data, type) {
    let width, height, direction = 1;
    if (type === 'png') {
        if (data.length < 33 || !data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
            || data.readUInt32BE(8) !== 13 || data.toString('ascii', 12, 16) !== 'IHDR') throw Error('PNG 尺寸头无效');
        width = data.readUInt32BE(16); height = data.readUInt32BE(20);
    } else if (type === 'jpg') {
        if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) throw Error('JPEG 文件头无效');
        let offset = 2, complete = false;
        while (offset < data.length) {
            if (data[offset++] !== 0xff) throw Error('JPEG 标记无效');
            while (data[offset] === 0xff) offset++;
            const marker = data[offset++];
            if (marker === 0xda || marker === 0xd9) { complete = true; break; }
            if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
            if (offset + 2 > data.length) break;
            const length = data.readUInt16BE(offset);
            if (length < 2 || offset + length > data.length) throw Error('JPEG 头不完整或超过 1 MiB 上限');
            if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
                if (length < 8) throw Error('JPEG 尺寸段无效');
                height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5);
            }
            if (marker === 0xe1 && data.toString('ascii', offset + 2, offset + 8) === 'Exif\0\0') {
                direction = orientation(data.subarray(offset + 2, offset + length));
            }
            offset += length;
        }
        if (!complete) throw Error('JPEG 头不完整或超过 1 MiB 上限');
    } else throw Error('此资源类型未实现图片尺寸读取');
    if (!width || !height || !Number.isSafeInteger(width * height)) throw Error('图片尺寸无效');
    return direction >= 5 ? { width: height, height: width } : { width, height };
}
module.exports = { dimensions };
