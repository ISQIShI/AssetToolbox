const sharp = require('sharp');
const fs = require('node:fs');
async function main() {
    if (process.argv[2] === '--check') return;
    const [input, output, json] = process.argv.slice(2), options = JSON.parse(json);
    // 静态 PNG 解码器可能忽略 APNG 控制块；显式拒绝，避免悄悄丢失动画。
    if (options.resourceType === 'png') {
        const bytes = fs.readFileSync(input);
        for (let offset = 8; offset + 12 <= bytes.length;) {
            const length = bytes.readUInt32BE(offset), end = offset + length + 12;
            if (end > bytes.length) throw new Error('PNG 数据块不完整');
            if (bytes.toString('ascii', offset + 4, offset + 8) === 'acTL') throw new Error('首版缩放不支持动画或多页图片');
            offset = end;
        }
    }
    const image = sharp(input, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if ((metadata.pages || 1) !== 1) throw new Error('首版缩放不支持动画或多页图片');
    if (!['png', 'jpeg'].includes(metadata.format) || metadata.format !== (options.resourceType === 'jpg' ? 'jpeg' : options.resourceType)) throw new Error('图片内容与资源类型不匹配');
    let result = image.autoOrient().resize({ width: options.width, height: options.height, fit: options.fit,
        kernel: options.kernel, withoutEnlargement: options.withoutEnlargement });
    result = options.resourceType === 'png' ? result.png() : result.jpeg({ quality: options.jpegQuality });
    const info = await result.toFile(output);
    if (!info.width || !info.height || info.width * info.height > 40_000_000) throw new Error('缩放输出尺寸无效');
    // 完整解码结果，防止只通过文件头检查的损坏输出进入提交阶段。
    await sharp(output, { limitInputPixels: 40_000_000, failOn: 'warning' }).raw().toBuffer();
    process.stdout.write(JSON.stringify({ width: info.width, height: info.height, format: info.format }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
