// 需要本地第三方编码器的跨模块验收，源码 CI 不执行此层。
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { fixture: applicationFixture } = require('./fixtures/application');
const { fixture: restoreFixture } = require('./fixtures/restore');
const report = state => JSON.parse(fs.readFileSync(path.join(state.reportDirectory, 'report.json')));

test('application executes real image resize and read-only audio analysis; measurements remain queryable', async t => {
    const f = applicationFixture(t);
    for (const name of ['ffmpeg.exe', 'ffprobe.exe']) fs.copyFileSync(path.join(__dirname, '../providers/ffmpeg', name), path.join(f.core, 'providers/ffmpeg', name));
    fs.symlinkSync(path.resolve(__dirname, '../node_modules'), path.join(f.core, 'node_modules'), 'junction');
    const sharp = require('sharp');
    const image = path.join(f.source, '图片.png');
    await sharp({ create: { width: 24, height: 16, channels: 4, background: '#4499aa' } }).png().toFile(image);
    const resize = f.service.submit({ ...f.request, pipeline: [{ id: 'resize', resourceType: 'png', operation: 'image-resize', provider: 'sharp', enabled: true, parameters: { width: 12, height: 12 } }] }, 'resize');
    assert.equal((await f.until(resize.jobId)).exitCode, 0);
    assert.equal((await sharp(path.join(f.output, '图片.png')).metadata()).width, 12);
    const audioFile = path.join(f.source, '声音.wav');
    const generated = spawnSync(path.join(f.core, 'providers/ffmpeg/ffmpeg.exe'), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audioFile], { windowsHide: true });
    assert.equal(generated.status, 0, generated.stderr.toString());
    const original = fs.readFileSync(audioFile), before = fs.statSync(audioFile).mtimeMs;
    const analyzed = f.service.submit({ mode: 'process', folder: f.source, pipeline: [{ id: 'analyze', resourceType: 'wav', operation: 'audio-analyze', provider: 'ffmpeg', enabled: true, parameters: {} }] }, 'analyze');
    assert.equal((await f.until(analyzed.jobId)).exitCode, 0);
    const rows = f.service.results(analyzed.jobId, 'audio', {}).items;
    assert.equal(rows.length, 1); assert.ok(Number.isFinite(rows[0].inputLufs));
    assert.deepEqual(fs.readFileSync(audioFile), original); assert.equal(fs.statSync(audioFile).mtimeMs, before);
    assert.equal(fs.existsSync(path.join(f.output, '声音.wav')), false);
    fs.unlinkSync(path.join(f.core, 'node_modules'));
});

test('real PNG, JPEG and MP3 compression backups restore byte-for-byte without invoking encoders again', { skip: process.platform !== 'win32' }, t => {
    const f = restoreFixture(t), source = path.join(f.root, '真实 图片音乐'); fs.mkdirSync(source);
    const script = `param($Source)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$bitmap=New-Object Drawing.Bitmap 256,256
$random=New-Object Random 42
try {
    for ($x=0; $x -lt 256; $x++) { for ($y=0; $y -lt 256; $y++) {
        $shade=$random.Next(16)*16
        $bitmap.SetPixel($x,$y,[Drawing.Color]::FromArgb($shade,$shade,255-$shade))
    } }
    $bitmap.Save((Join-Path $Source '测试.png'),[Drawing.Imaging.ImageFormat]::Png)
    $codec=[Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $parameters=New-Object Drawing.Imaging.EncoderParameters 1
    $parameters.Param[0]=New-Object Drawing.Imaging.EncoderParameter ([Drawing.Imaging.Encoder]::Quality),([long]100)
    try { $bitmap.Save((Join-Path $Source '测试.jpg'),$codec,$parameters) } finally { $parameters.Dispose() }
} finally { $bitmap.Dispose() }
`;
    const driver = path.join(f.root, 'images.ps1'); fs.writeFileSync(driver, '\uFEFF' + script);
    const imageResult = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', driver, source], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(imageResult.status, 0, imageResult.stdout + imageResult.stderr);
    const rate = 44100, samples = rate * 2, wav = Buffer.alloc(44 + samples * 4);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28); wav.writeUInt16LE(4, 32);
    wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 4, 40);
    for (let index = 0; index < samples; index++) {
        const value = Math.round(Math.sin(index * 2 * Math.PI * 440 / rate) * 16000);
        wav.writeInt16LE(value, 44 + index * 4); wav.writeInt16LE(-value, 46 + index * 4);
    }
    const input = path.join(f.root, 'input.wav'); fs.writeFileSync(input, wav);
    const music = path.join(source, '主题.mp3');
    const audioResult = spawnSync(path.join(f.tool, 'resource-core/providers/lame/lame.exe'), ['-b', '192', input, music], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
    assert.equal(audioResult.status, 0, audioResult.stderr);
    const originals = fs.readdirSync(source).map(name => [name, fs.readFileSync(path.join(source, name))]);
    const processed = f.run({ mode: 'process', folder: source, backupDir: path.join(f.root, 'real-backup'), options: { mp3Enabled: true } });
    assert.equal(processed.summary.processed, 3, JSON.stringify(report(processed)));
    const done = f.run({ mode: 'restore', taskFile: processed.task.taskFile });
    assert.equal(done.summary.restored, 3, JSON.stringify(report(done)));
    for (const [name, data] of originals) assert.deepEqual(fs.readFileSync(path.join(source, name)), data);
});
