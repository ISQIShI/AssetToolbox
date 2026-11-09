// 只接受核验摘要后的 npm TAR 与固定文件 ZIP；拒绝链接、重复路径和扩容炸弹。
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { safePath, hash } = require('./paths');
const MAX_EXPANDED = 128 * 1024 * 1024;
function put(root, relative, bytes, seen) {
    const key = relative.toLowerCase();
    if (seen.has(key)) throw new Error('归档含重复文件');
    seen.add(key);
    const target = safePath(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes, { flag: 'wx' });
}
function tar(bytes, root, target) {
    const data = zlib.gunzipSync(bytes, { maxOutputLength: MAX_EXPANDED }), seen = new Set();
    const string = (offset, length) => data.subarray(offset, offset + length).toString('utf8').split('\0')[0];
    let offset = 0, count = 0;
    for (; offset + 512 <= data.length; ) {
        if (data.subarray(offset, offset + 512).every(byte => byte === 0)) break;
        const number = (start, length) => {
            const value = string(offset + start, length).trim();
            if (!/^[0-7]+$/.test(value)) throw new Error('不支持的 TAR 数字');
            return parseInt(value, 8);
        };
        const expected = number(148, 8);
        let checksum = 0;
        for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : data[offset + i];
        if (checksum !== expected) throw new Error('TAR 头校验失败');
        const prefix = string(offset + 345, 155), name = (prefix ? prefix + '/' : '') + string(offset, 100);
        const type = string(offset + 156, 1), size = number(124, 12);
        if (++count > 10000 || offset + 512 + size > data.length) throw new Error('归档大小或数量无效');
        if (!name.startsWith('package/') || !['', '0', '5'].includes(type)) throw new Error('归档包含不支持的路径或链接');
        const relative = name.slice(8).replace(/\/$/, '');
        if (relative) safePath(root, target + '/' + relative);
        if (type !== '5') put(root, target + '/' + relative, data.subarray(offset + 512, offset + 512 + size), seen);
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    if (!seen.size || offset + 1024 > data.length || !data.subarray(offset).every(byte => byte === 0)) throw new Error('TAR 未正常结束');
}
function zip(bytes, root, files) {
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
    if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50 || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) throw new Error('ZIP 尾部无效');
    if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw new Error('不支持多卷 ZIP');
    const count = bytes.readUInt16LE(end + 10), seen = new Set(), names = new Set();
    let offset = bytes.readUInt32LE(end + 16), expanded = 0;
    if (!count || count > 1000) throw new Error('ZIP 文件数量无效');
    for (let i = 0; i < count; i++) {
        if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP 目录无效');
        const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
        const compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24);
        const length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
        const name = bytes.toString('utf8', offset + 46, offset + 46 + length);
        safePath(root, name);
        if (names.has(name.toLowerCase()) || (flags & 1) || ![0, 8].includes(method) || (bytes.readUInt32LE(offset + 38) >>> 16 & 0xf000) === 0xa000) throw new Error('ZIP 含重复、加密或链接文件');
        names.add(name.toLowerCase()); expanded += size;
        if (expanded > MAX_EXPANDED) throw new Error('ZIP 解压大小超过上限');
        if (Object.hasOwn(files, name)) {
            const local = bytes.readUInt32LE(offset + 42);
            if (local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) throw new Error('ZIP 文件头无效');
            const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
            if (start + compressed > offset) throw new Error('ZIP 内容越界');
            const packed = bytes.subarray(start, start + compressed);
            const content = method === 0 ? packed : zlib.inflateRawSync(packed, { maxOutputLength: Math.max(1, size) });
            if (content.length !== size || hash(content) !== files[name]) throw new Error('依赖文件摘要校验失败');
            put(root, name, content, seen);
        }
        offset += 46 + length + extra + comment;
    }
    if (Object.keys(files).some(file => !seen.has(file.toLowerCase()))) throw new Error('ZIP 缺少必需文件');
}
module.exports = { tar, zip };
