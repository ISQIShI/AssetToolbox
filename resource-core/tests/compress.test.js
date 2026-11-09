const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const childProcess = require('node:child_process');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { collectImages, compressFolder } = require('../compress');

const windowsOnly = { skip: process.platform !== 'win32' };
const projectRoot = path.resolve(__dirname, '../..');

function powershell(script, env = {}, cwd = projectRoot) {
    // EncodedCommand avoids the default ANSI decoding of .ps1 files on Windows PowerShell.
    const result = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
    ], {
        cwd,
        env: { ...process.env, ...env },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout.trim();
}

function temporaryRoot(t) {
    const temp = fs.realpathSync(os.tmpdir());
    const root = fs.realpathSync(fs.mkdtempSync(path.join(temp, 'resource-compress-test-')));
    t.after(() => {
        // Only remove this test's generated directory, after checking its absolute location.
        const resolved = fs.realpathSync(root);
        assert.equal(path.dirname(resolved), temp);
        assert.ok(path.basename(resolved).startsWith('resource-compress-test-'));
        fs.rmSync(resolved, { recursive: true, force: true });
    });
    return root;
}

function createImages(root, specs) {
    const manifest = path.join(root, 'fixtures.json');
    fs.writeFileSync(manifest, JSON.stringify(specs.map(spec => ({
        ...spec, file: path.join(root, spec.name),
    }))));
    powershell(`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$specs = Get-Content -LiteralPath $env:IMAGE_TEST_MANIFEST -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($spec in $specs) {
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($spec.file)) | Out-Null
    $bitmap = New-Object System.Drawing.Bitmap ([int]$spec.width), ([int]$spec.height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::FromArgb([int]$spec.color[0], [int]$spec.color[1], [int]$spec.color[2]))
        # A few hundred colored blocks produce compressible real images, retaining a solid corner.
        for ($x = 24; $x -lt $spec.width; $x += 12) {
            for ($y = 24; $y -lt $spec.height; $y += 12) {
                $r = ([int]$spec.color[0] + $x) % 256
                $g = ([int]$spec.color[1] + $y) % 256
                $b = ([int]$spec.color[2] + $x + $y) % 256
                $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($r, $g, $b))
                try { $graphics.FillRectangle($brush, $x, $y, 12, 12) } finally { $brush.Dispose() }
            }
        }
        if ($spec.name -match '(?i)\\.png$') {
            # A noisy 16-color interior benefits from indexed PNG compression without quality loss.
            $random = New-Object System.Random 12345
            for ($x = 24; $x -lt $spec.width; $x++) {
                for ($y = 24; $y -lt $spec.height; $y++) {
                    $shade = $random.Next(16) * 7
                    $color = [System.Drawing.Color]::FromArgb(
                        (([int]$spec.color[0] + $shade) % 256),
                        (([int]$spec.color[1] + $shade) % 256),
                        (([int]$spec.color[2] + $shade) % 256))
                    $bitmap.SetPixel($x, $y, $color)
                }
            }
            $bitmap.Save($spec.file, [System.Drawing.Imaging.ImageFormat]::Png)
        } else {
            $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object MimeType -eq 'image/jpeg'
            $parameters = New-Object System.Drawing.Imaging.EncoderParameters 1
            $quality = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]100)
            try {
                $parameters.Param[0] = $quality
                $bitmap.Save($spec.file, $codec, $parameters)
            } finally { $parameters.Dispose() }
        }
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
}
`, { IMAGE_TEST_MANIFEST: manifest });
    return specs.map(spec => path.join(root, spec.name));
}

function inspectImages(root, files) {
    const manifest = path.join(root, 'inspect.json');
    fs.writeFileSync(manifest, JSON.stringify(files));
    return JSON.parse(powershell(`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Add-Type -AssemblyName System.Drawing
$files = Get-Content -LiteralPath $env:IMAGE_TEST_MANIFEST -Raw -Encoding UTF8 | ConvertFrom-Json
$result = @(foreach ($file in $files) {
    $bitmap = New-Object System.Drawing.Bitmap $file
    try {
        $pixel = $bitmap.GetPixel(8, 8)
        @{ width = $bitmap.Width; height = $bitmap.Height; color = @([int]$pixel.R, [int]$pixel.G, [int]$pixel.B) }
    } finally { $bitmap.Dispose() }
})
ConvertTo-Json -InputObject $result -Compress
`, { IMAGE_TEST_MANIFEST: manifest }));
}

function hashFile(file) {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function snapshotFiles(root) {
    const result = {};
    function visit(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) visit(file);
            else if (entry.isFile()) result[path.relative(root, file)] = hashFile(file);
        }
    }
    visit(root);
    return result;
}

function writeTinyPng(file) {
    // A valid, minimal 1x1 true-color PNG is smaller than pngquant's indexed output.
    function chunk(type, payload) {
        const body = Buffer.concat([Buffer.from(type), payload]);
        let crc = 0xffffffff;
        for (const byte of body) {
            crc ^= byte;
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        const header = Buffer.alloc(4);
        header.writeUInt32BE(payload.length);
        const checksum = Buffer.alloc(4);
        checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
        return Buffer.concat([header, body, checksum]);
    }
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 2;
    const png = Buffer.concat([
        Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))), chunk('IEND', Buffer.alloc(0)),
    ]);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, png);
    return png;
}

test('recurses through Chinese/spaced paths and preserves each PNG/JPG/JPEG image identity', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, '选择的 图片目录');
    fs.mkdirSync(selected);
    const specs = [
        { name: 'root.png', width: 360, height: 240, color: [210, 30, 40] },
        { name: '甲 文件夹/同名.PNG', width: 220, height: 160, color: [200, 30, 30] },
        { name: '乙 文件夹/同名.PNG', width: 280, height: 180, color: [30, 30, 200] },
        { name: '甲 文件夹/photo.JPG', width: 260, height: 200, color: [190, 180, 30] },
        { name: '乙 文件夹/photo.JPG', width: 340, height: 220, color: [30, 180, 30] },
        { name: '更深/多一层/image.JpEg', width: 380, height: 230, color: [180, 30, 180] },
        { name: 'lower.jpg', width: 300, height: 250, color: [30, 150, 180] },
        { name: 'lower.jpeg', width: 320, height: 260, color: [180, 110, 30] },
        { name: 'UPPER.JPEG', width: 330, height: 270, color: [120, 60, 160] },
    ];
    const files = createImages(selected, specs);
    const original = new Map(files.map(file => [file, fs.readFileSync(file)]));
    const ignoredNames = ['ignored.txt', 'ignored.png.bak', 'ignored.jpg.txt'];
    for (const name of ignoredNames) fs.copyFileSync(files[0], path.join(selected, name));
    assert.equal(collectImages(selected).files.length, specs.length);

    const messages = [];
    const summary = compressFolder(selected, { log: message => messages.push(message) });
    assert.equal(summary.total, specs.length);
    assert.equal(summary.failed, 0, messages.join('\n'));
    assert.equal(summary.compressed + summary.skipped, specs.length);
    assert.ok(files.some(file => /\.png$/i.test(file) && fs.statSync(file).size < original.get(file).length), 'real pngquant should shrink a PNG fixture');
    assert.ok(files.some(file => /\.jpe?g$/i.test(file) && fs.statSync(file).size < original.get(file).length), 'real JPG-C should shrink a JPEG fixture');
    for (const name of ignoredNames) assert.deepEqual(fs.readFileSync(path.join(selected, name)), original.get(files[0]));
    assert.equal(summary.savedBytes, files.reduce((saved, file) => saved + original.get(file).length - fs.statSync(file).size, 0));
    const decoded = inspectImages(selected, files);
    decoded.forEach((image, index) => {
        const spec = specs[index];
        assert.equal(image.width, spec.width, spec.name);
        assert.equal(image.height, spec.height, spec.name);
        image.color.forEach((channel, channelIndex) => {
            assert.ok(Math.abs(channel - spec.color[channelIndex]) < 50, `${spec.name}: corner color changed to ${image.color}`);
        });
        assert.ok(fs.statSync(files[index]).size <= original.get(files[index]).length, spec.name);
    });
    assert.ok(messages.some(message => message.includes('同名.PNG')));
});

test('does not follow junctions outside the selected folder or into a directory cycle', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, 'selected');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(selected);
    fs.mkdirSync(outside);
    const image = Buffer.from('not an image, must never be touched');
    fs.writeFileSync(path.join(outside, 'outside.png'), image);
    fs.symlinkSync(outside, path.join(selected, 'outside-link'), 'junction');
    fs.symlinkSync(selected, path.join(selected, 'cycle-link'), 'junction');
    assert.deepEqual(collectImages(selected).files, []);
    assert.equal(compressFolder(selected, { log() {} }).total, 0);
    assert.deepEqual(fs.readFileSync(path.join(outside, 'outside.png')), image);
});

test('preserves fake and corrupt images, then continues to valid PNG and JPEG files', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, '损坏图片 fixtures');
    fs.mkdirSync(selected);
    const invalid = new Map([
        ['00-corrupt.jpg', Buffer.from('ffd8ffe000104a464946', 'hex')],
        ['01-corrupt.PNG', Buffer.from('89504e470d0a1a0a000000', 'hex')],
        ['02-fake.png', Buffer.from('not a PNG image')],
        ['03-fake.JPEG', Buffer.from('not a JPEG image')],
    ]);
    for (const [name, bytes] of invalid) fs.writeFileSync(path.join(selected, name), bytes);
    const files = createImages(selected, [
        { name: 'zz-valid.jpg', width: 320, height: 240, color: [30, 140, 210] },
        { name: 'zz-valid.png', width: 350, height: 260, color: [210, 140, 30] },
    ]);
    const jpegBefore = fs.readFileSync(files[0]);
    const disguised = fs.readFileSync(files[1]);
    invalid.set('04-png-disguised.jpg', disguised);
    fs.writeFileSync(path.join(selected, '04-png-disguised.jpg'), disguised);
    const messages = [];
    const summary = compressFolder(selected, { log: message => messages.push(message) });
    assert.equal(summary.total, invalid.size + files.length);
    assert.equal(summary.failed, invalid.size, messages.join('\n'));
    assert.equal(summary.compressed + summary.skipped, files.length);
    for (const [name, bytes] of invalid) assert.deepEqual(fs.readFileSync(path.join(selected, name)), bytes, name);
    assert.ok(fs.statSync(files[0]).size < jpegBefore.length, 'a corrupt JPEG log must not prevent the later valid JPEG from compressing');
    assert.equal(inspectImages(selected, files).length, files.length);
    assert.ok(messages.some(message => message.includes('失败 00-corrupt.jpg')), messages.join('\n'));
    assert.ok(messages.some(message => message.includes('已压缩 zz-valid.jpg')), messages.join('\n'));
    assert.deepEqual(fs.readdirSync(selected).filter(name => name.endsWith('.log') || name.startsWith('.resource-compress-')), []);
});

test('empty directories and invalid paths have clear outcomes', windowsOnly, t => {
    const root = temporaryRoot(t);
    assert.deepEqual(compressFolder(root, { log() {} }), {
        total: 0, compressed: 0, skipped: 0, failed: 0, savedBytes: 0,
        copied: 0, backedUp: 0, backupDirectory: null,
    });
    assert.throws(() => compressFolder(path.join(root, 'missing')), { code: 'ENOENT' });
    const file = path.join(root, 'not-a-directory.txt');
    fs.writeFileSync(file, 'fixture');
    assert.throws(() => compressFolder(file), /目标不是文件夹/);
    const result = spawnSync(process.execPath, [path.join(projectRoot, 'resource-core/compress.js'), file], {
        cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /目标不是文件夹/);
});

test('save-as preserves every source hash and relative image path, including same-name files', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, '原图 目录');
    const output = path.join(root, '另存 结果');
    fs.mkdirSync(selected);
    const specs = [
        { name: '甲 子目录/同名.PNG', width: 220, height: 160, color: [200, 30, 30] },
        { name: '乙 子目录/同名.PNG', width: 280, height: 180, color: [30, 30, 200] },
        { name: '更深/第三层/照片.JPG', width: 320, height: 240, color: [30, 180, 30] },
        { name: 'root.JpEg', width: 300, height: 220, color: [180, 30, 180] },
    ];
    const files = createImages(selected, specs);
    fs.writeFileSync(path.join(selected, 'ignored.txt'), 'Leave non-image files in the source.');
    const before = snapshotFiles(selected);
    const summary = compressFolder(selected, { outputDir: output, log() {} });
    assert.equal(summary.total, files.length);
    assert.equal(summary.failed, 0);
    assert.equal(summary.backedUp, 0);
    assert.equal(summary.backupDirectory, null);
    assert.deepEqual(snapshotFiles(selected), before, 'save-as must not modify source bytes or add source files');
    assert.deepEqual(Object.keys(snapshotFiles(output)).sort(), files.map(file => path.relative(selected, file)).sort());
    const outputFiles = files.map(file => path.join(output, path.relative(selected, file)));
    assert.ok(outputFiles.some((file, index) => fs.statSync(file).size < fs.statSync(files[index]).size));
    assert.equal(summary.savedBytes, outputFiles.reduce((sum, file, index) => sum + fs.statSync(files[index]).size - fs.statSync(file).size, 0));
    const decoded = inspectImages(root, outputFiles);
    decoded.forEach((image, index) => {
        assert.equal(image.width, specs[index].width, specs[index].name);
        assert.equal(image.height, specs[index].height, specs[index].name);
    });
});

test('save-as copies unchanged and failed images byte-for-byte while reporting failures', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, 'source');
    const output = path.join(root, 'output');
    fs.mkdirSync(selected);
    const tiny = writeTinyPng(path.join(selected, 'nested', 'tiny.png'));
    const corrupt = Buffer.from('89504e470d0a1a0a000000', 'hex');
    const fake = Buffer.from('not a JPEG image');
    fs.writeFileSync(path.join(selected, 'broken.PNG'), corrupt);
    fs.writeFileSync(path.join(selected, 'fake.JPG'), fake);
    const before = snapshotFiles(selected);
    const summary = compressFolder(selected, { outputDir: output, log() {} });
    assert.equal(summary.total, 3);
    assert.equal(summary.compressed, 0);
    assert.equal(summary.skipped, 1, 'the minimal valid PNG should be kept because it cannot become smaller');
    assert.equal(summary.failed, 2);
    assert.equal(summary.copied, 3);
    assert.equal(summary.savedBytes, 0);
    assert.deepEqual(snapshotFiles(selected), before);
    assert.deepEqual(fs.readFileSync(path.join(output, 'nested', 'tiny.png')), tiny);
    assert.deepEqual(fs.readFileSync(path.join(output, 'broken.PNG')), corrupt);
    assert.deepEqual(fs.readFileSync(path.join(output, 'fake.JPG')), fake);
});

test('backup preserves exact originals only for replaced images and keeps earlier runs', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, 'source');
    const backup = path.join(root, '备份 文件夹');
    fs.mkdirSync(selected);
    const [png, jpeg] = createImages(selected, [
        { name: '甲/same.PNG', width: 220, height: 160, color: [200, 30, 30] },
        { name: '乙/same.JPG', width: 320, height: 240, color: [30, 180, 30] },
    ]);
    const originals = new Map([png, jpeg].map(file => [file, fs.readFileSync(file)]));
    const tiny = path.join(selected, 'tiny.png');
    const tinyBytes = writeTinyPng(tiny);
    const invalid = path.join(selected, 'broken.jpg');
    fs.writeFileSync(invalid, 'invalid JPEG');
    const summary = compressFolder(selected, { backupDir: backup, log() {} });
    assert.equal(summary.failed, 1);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.compressed, 2);
    assert.equal(summary.backedUp, 2);
    assert.equal(path.dirname(summary.backupDirectory), backup);
    const expected = [];
    for (const [file, bytes] of originals) {
        const relative = path.relative(selected, file);
        expected.push(relative);
        assert.deepEqual(fs.readFileSync(path.join(summary.backupDirectory, relative)), bytes, relative);
        assert.ok(fs.statSync(file).size < bytes.length, relative);
    }
    assert.deepEqual(Object.keys(snapshotFiles(summary.backupDirectory)).sort(), expected.sort());
    assert.deepEqual(fs.readFileSync(tiny), tinyBytes);
    assert.equal(fs.readFileSync(invalid, 'utf8'), 'invalid JPEG');
    const firstBackup = snapshotFiles(summary.backupDirectory);
    // Restoring these generated fixtures makes a second replacement deterministic.
    for (const [file, bytes] of originals) fs.writeFileSync(file, bytes);
    const second = compressFolder(selected, { backupDir: backup, log() {} });
    assert.equal(second.backedUp, 2);
    assert.notEqual(second.backupDirectory, summary.backupDirectory);
    assert.deepEqual(snapshotFiles(summary.backupDirectory), firstBackup, 'later runs must not replace older backups');
    assert.deepEqual(snapshotFiles(second.backupDirectory), firstBackup);
});

test('nested output and backup folders are excluded from the source traversal', windowsOnly, t => {
    const root = temporaryRoot(t);
    for (const mode of ['outputDir', 'backupDir']) {
        const selected = path.join(root, mode);
        const destination = path.join(selected, 'nested', 'results');
        fs.mkdirSync(selected);
        const [image] = createImages(selected, [
            { name: 'pictures/photo.jpg', width: 320, height: 240, color: [30, 180, 30] },
        ]);
        fs.mkdirSync(destination, { recursive: true });
        const sentinel = path.join(destination, 'old', 'must-not-process.PNG');
        fs.mkdirSync(path.dirname(sentinel));
        fs.writeFileSync(sentinel, 'invalid image in excluded destination');
        const before = fs.readFileSync(image);
        const summary = compressFolder(selected, { [mode]: destination, log() {} });
        assert.equal(summary.total, 1, mode);
        assert.equal(summary.failed, 0, mode);
        assert.equal(fs.readFileSync(sentinel, 'utf8'), 'invalid image in excluded destination', mode);
        if (mode === 'outputDir') {
            assert.deepEqual(fs.readFileSync(image), before);
            assert.ok(fs.existsSync(path.join(destination, 'pictures', 'photo.jpg')));
        } else {
            assert.deepEqual(fs.readFileSync(path.join(summary.backupDirectory, 'pictures', 'photo.jpg')), before);
        }
    }
});

test('rejects source/ancestor destinations, mutually exclusive modes, and non-directory targets', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, 'source');
    fs.mkdirSync(selected);
    writeTinyPng(path.join(selected, 'tiny.png'));
    const before = snapshotFiles(selected);
    const occupied = path.join(root, 'occupied.txt');
    fs.writeFileSync(occupied, 'existing file');
    for (const mode of ['outputDir', 'backupDir']) {
        for (const destination of [selected, root, occupied]) {
            assert.throws(() => compressFolder(selected, { [mode]: destination, log() {} }), undefined, `${mode}: ${destination}`);
        }
    }
    assert.throws(() => compressFolder(selected, {
        outputDir: path.join(root, 'output'), backupDir: path.join(root, 'backup'), log() {},
    }));
    assert.deepEqual(snapshotFiles(selected), before);
    assert.equal(fs.readFileSync(occupied, 'utf8'), 'existing file');
});

test('save-as refuses existing output files and path collisions without modifying either side', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, 'source');
    const output = path.join(root, 'output');
    fs.mkdirSync(selected);
    fs.mkdirSync(output);
    createImages(selected, [
        { name: 'existing.jpg', width: 320, height: 240, color: [30, 180, 30] },
        { name: 'blocked/photo.jpg', width: 320, height: 240, color: [180, 30, 30] },
        { name: 'success/photo.jpg', width: 320, height: 240, color: [30, 30, 180] },
    ]);
    fs.writeFileSync(path.join(output, 'existing.jpg'), 'preserve existing output');
    fs.writeFileSync(path.join(output, 'blocked'), 'file blocks subdirectory creation');
    const before = snapshotFiles(selected);
    const summary = compressFolder(selected, { outputDir: output, log() {} });
    assert.equal(summary.total, 3);
    assert.equal(summary.failed, 2);
    assert.equal(summary.compressed, 1);
    assert.deepEqual(snapshotFiles(selected), before);
    assert.equal(fs.readFileSync(path.join(output, 'existing.jpg'), 'utf8'), 'preserve existing output');
    assert.equal(fs.readFileSync(path.join(output, 'blocked'), 'utf8'), 'file blocks subdirectory creation');
    assert.ok(fs.statSync(path.join(output, 'success', 'photo.jpg')).size < fs.statSync(path.join(selected, 'success', 'photo.jpg')).size);
});

test('resolves explicitly selected junction roots safely and refuses output subdirectory junctions', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, 'source');
    const outside = path.join(root, 'outside');
    const output = path.join(root, 'output');
    fs.mkdirSync(selected);
    fs.mkdirSync(outside);
    fs.mkdirSync(output);
    createImages(selected, [
        { name: 'nested/photo.jpg', width: 320, height: 240, color: [30, 180, 30] },
    ]);
    const before = snapshotFiles(selected);
    const sourceAlias = path.join(root, 'source-link');
    fs.symlinkSync(selected, sourceAlias, 'junction');
    for (const mode of ['outputDir', 'backupDir']) {
        assert.throws(() => compressFolder(selected, { [mode]: sourceAlias, log() {} }));
    }
    const link = path.join(root, 'destination-link');
    fs.symlinkSync(outside, link, 'junction');
    const safeAliasResult = compressFolder(selected, { outputDir: link, log() {} });
    assert.equal(safeAliasResult.failed, 0);
    assert.ok(fs.existsSync(path.join(outside, 'nested', 'photo.jpg')));
    const outsideBefore = snapshotFiles(outside);
    fs.symlinkSync(outside, path.join(output, 'nested'), 'junction');
    const summary = compressFolder(selected, { outputDir: output, log() {} });
    assert.equal(summary.failed, 1);
    assert.equal(summary.compressed, 0);
    assert.deepEqual(snapshotFiles(outside), outsideBefore);
    assert.deepEqual(snapshotFiles(selected), before);
});

test('backup write failure prevents replacement and leaves original bytes intact', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, 'source');
    const backup = path.join(root, 'backup');
    fs.mkdirSync(selected);
    fs.mkdirSync(backup);
    const [image] = createImages(selected, [
        { name: 'nested/photo.jpg', width: 320, height: 240, color: [30, 180, 30] },
    ]);
    const before = fs.readFileSync(image);
    const openSync = fs.openSync;
    let injected = false;
    fs.openSync = function(filename, ...args) {
        if (typeof filename === 'string' && filename.startsWith(backup + path.sep)) {
            injected = true;
            const error = new Error('Simulated backup write permission failure');
            error.code = 'EACCES';
            throw error;
        }
        return openSync.call(this, filename, ...args);
    };
    let summary;
    try {
        summary = compressFolder(selected, { backupDir: backup, log() {} });
    } finally {
        fs.openSync = openSync;
    }
    assert.equal(injected, true, 'the test must fail the actual backup write');
    assert.equal(summary.failed, 1);
    assert.equal(summary.compressed, 0);
    assert.equal(summary.backedUp, 0);
    assert.deepEqual(fs.readFileSync(image), before);
});

test('implicit defaults and explicit original parameters produce identical images and original tool arguments', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, 'source');
    fs.mkdirSync(selected);
    const files = createImages(selected, [
        { name: 'nested/image.PNG', width: 220, height: 160, color: [200, 30, 30] },
        { name: 'nested/photo.JPG', width: 320, height: 240, color: [30, 180, 30] },
    ]);
    const before = snapshotFiles(selected);
    const calls = [];
    const mock = t.mock.method(childProcess, 'spawnSync', function(executable, args, options) {
        calls.push({ executable, args: [...args] });
        return spawnSync(executable, args, options);
    });
    const defaults = path.join(root, 'defaults');
    const explicit = path.join(root, 'explicit');
    for (const [outputDir, options] of [
        [defaults, {}],
        [explicit, { pngSpeed: 3, pngQualityMin: 50, pngQualityMax: 80, jpgQuality: 5 }],
    ]) {
        const summary = compressFolder(selected, { ...options, outputDir, log() {} });
        assert.equal(summary.total, files.length);
        assert.equal(summary.failed, 0);
    }
    mock.mock.restore();
    assert.deepEqual(snapshotFiles(selected), before);
    assert.deepEqual(snapshotFiles(defaults), snapshotFiles(explicit));
    const pngCalls = calls.filter(call => /pngquant/i.test(call.executable));
    const jpgCalls = calls.filter(call => /JPG-C/i.test(call.executable));
    assert.equal(pngCalls.length, 2);
    assert.equal(jpgCalls.length, 2);
    for (const { args } of pngCalls) {
        assert.deepEqual(args.slice(0, -1), ['-f', '--ext', '.png', '--speed', '3', '--quality', '50-80', '--skip-if-larger']);
    }
    for (const { args } of jpgCalls) assert.deepEqual(args.slice(0, -1), ['-m', '1', '-q', '5', '-di']);
});

test('custom parameters reach the real processors and preserve save-as paths and originals', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, '原图 目录');
    const output = path.join(root, '另存 结果');
    fs.mkdirSync(selected);
    const specs = [
        { name: '甲 子目录/同名.PNG', width: 220, height: 160, color: [200, 30, 30] },
        { name: '乙 子目录/同名.PNG', width: 280, height: 180, color: [30, 30, 200] },
        { name: '更深/第三层/照片.JPG', width: 320, height: 240, color: [30, 180, 30] },
    ];
    const files = createImages(selected, specs);
    const before = snapshotFiles(selected);
    const calls = [];
    const mock = t.mock.method(childProcess, 'spawnSync', function(executable, args, options) {
        calls.push({ executable, args: [...args] });
        return spawnSync(executable, args, options);
    });
    const summary = compressFolder(selected, {
        pngSpeed: 2, pngQualityMin: 20, pngQualityMax: 75, jpgQuality: 7,
        outputDir: output, log() {},
    });
    mock.mock.restore();
    assert.equal(summary.failed, 0);
    assert.equal(summary.compressed, files.length);
    assert.deepEqual(snapshotFiles(selected), before);
    assert.deepEqual(Object.keys(snapshotFiles(output)).sort(), files.map(file => path.relative(selected, file)).sort());
    assert.equal(calls.length, files.length);
    for (const { executable, args } of calls) {
        assert.deepEqual(args.slice(0, -1), /pngquant/i.test(executable)
            ? ['-f', '--ext', '.png', '--speed', '2', '--quality', '20-75', '--skip-if-larger']
            : ['-m', '1', '-q', '7', '-di']);
    }
    const outputs = files.map(file => path.join(output, path.relative(selected, file)));
    inspectImages(root, outputs).forEach((decoded, index) => {
        assert.equal(decoded.width, specs[index].width);
        assert.equal(decoded.height, specs[index].height);
        assert.ok(fs.statSync(outputs[index]).size < fs.statSync(files[index]).size);
    });
});

test('accepts compression parameter endpoints and equal PNG quality bounds with real images', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, 'source');
    fs.mkdirSync(selected);
    const files = createImages(selected, [
        { name: 'image.png', width: 220, height: 160, color: [200, 30, 30] },
        { name: 'photo.jpg', width: 320, height: 240, color: [30, 180, 30] },
    ]);
    const before = snapshotFiles(selected);
    const boundaryOptions = [
        { pngSpeed: 1, pngQualityMin: 0, pngQualityMax: 0, jpgQuality: 0 },
        { pngSpeed: 11, pngQualityMin: 100, pngQualityMax: 100, jpgQuality: 9 },
        { pngSpeed: 3, pngQualityMin: 0, pngQualityMax: 100, jpgQuality: 5 },
    ];
    for (const [index, options] of boundaryOptions.entries()) {
        const outputDir = path.join(root, `output-${index}`);
        const messages = [];
        const summary = compressFolder(selected, { ...options, outputDir, log: message => messages.push(message) });
        assert.equal(summary.total, 2);
        assert.equal(summary.failed, 0, `${JSON.stringify(options)}: ${messages.join('\n')}`);
        assert.equal(summary.compressed + summary.skipped, 2);
        const outputFiles = files.map(file => path.join(outputDir, path.relative(selected, file)));
        assert.equal(inspectImages(root, outputFiles).length, files.length);
        if (options.jpgQuality === 0) {
            assert.equal(hashFile(outputFiles[1]), hashFile(files[1]), 'JPG quality 0 must preserve the uncompressed JPEG');
        }
    }
    assert.deepEqual(snapshotFiles(selected), before);
});

test('invalid compression settings fail before scanning, creating temporary files, or touching destinations', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, 'source');
    fs.mkdirSync(selected);
    writeTinyPng(path.join(selected, 'nested', 'tiny.png'));
    const before = snapshotFiles(selected);
    const invalid = [
        { pngSpeed: 0 }, { pngSpeed: 12 },
        { pngQualityMin: -1 }, { pngQualityMin: 101 },
        { pngQualityMax: -1 }, { pngQualityMax: 101 },
        { pngQualityMin: 81 }, { pngQualityMax: 49 },
        { pngQualityMin: 80, pngQualityMax: 20 },
        { jpgQuality: -1 }, { jpgQuality: 10 },
    ];
    for (const key of ['pngSpeed', 'pngQualityMin', 'pngQualityMax', 'jpgQuality']) {
        for (const value of [1.5, NaN, Infinity, '3', null, true]) invalid.push({ [key]: value });
    }
    const unexpected = new Error('invalid options reached filesystem traversal or mutation');
    const guardedMethods = ['readdirSync', 'mkdtempSync', 'mkdirSync', 'writeFileSync', 'openSync'];
    const guards = guardedMethods.map(method => t.mock.method(fs, method, () => { throw unexpected; }));
    const destinations = [];
    try {
        invalid.forEach((options, index) => {
            const destination = path.join(root, `invalid-${index}`);
            destinations.push(destination);
            const mode = index % 2 ? 'backupDir' : 'outputDir';
            assert.throws(() => compressFolder(selected, { ...options, [mode]: destination, log() {} }), error => {
                assert.notEqual(error, unexpected, `${JSON.stringify(options)} reached the filesystem`);
                assert.match(error.message, /png|jpg|quality|speed|参数|速度|质量/i);
                return true;
            });
        });
        guards.forEach((guard, index) => assert.equal(guard.mock.callCount(), 0, guardedMethods[index]));
    } finally {
        guards.forEach(guard => guard.mock.restore());
    }
    assert.deepEqual(snapshotFiles(selected), before);
    destinations.forEach(destination => assert.equal(fs.existsSync(destination), false));
});

test('JPG quality zero leaves originals unchanged, creates no backups, and copies save-as output exactly', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, 'source');
    const backup = path.join(root, 'backup');
    const output = path.join(root, 'output');
    fs.mkdirSync(selected);
    const [file] = createImages(selected, [
        { name: 'nested/photo.jpg', width: 320, height: 240, color: [30, 180, 30] },
    ]);
    const before = snapshotFiles(selected);
    const overwrite = compressFolder(selected, { jpgQuality: 0, backupDir: backup, log() {} });
    assert.equal(overwrite.failed, 0);
    assert.equal(overwrite.compressed, 0);
    assert.equal(overwrite.skipped, 1);
    assert.equal(overwrite.backedUp, 0);
    assert.equal(overwrite.backupDirectory, null);
    assert.equal(fs.existsSync(backup), false);
    assert.deepEqual(snapshotFiles(selected), before);
    const saveAs = compressFolder(selected, { jpgQuality: 0, outputDir: output, log() {} });
    assert.equal(saveAs.failed, 0);
    assert.equal(saveAs.compressed, 0);
    assert.equal(saveAs.skipped, 1);
    assert.equal(saveAs.copied, 1);
    assert.equal(hashFile(path.join(output, 'nested/photo.jpg')), hashFile(file));
    assert.deepEqual(snapshotFiles(selected), before);
});

test('CLI rejects malformed, missing, repeated, out-of-range, and inconsistent parameters before writing', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, 'source');
    fs.mkdirSync(selected);
    writeTinyPng(path.join(selected, 'tiny.png'));
    const before = snapshotFiles(selected);
    const flags = ['--png-speed', '--png-quality-min', '--png-quality-max', '--jpg-quality'];
    const invalid = [
        ['--unknown', '3'], ['--png-speed', '0'], ['--png-speed', '12'],
        ['--png-quality-min', '-1'], ['--png-quality-max', '101'],
        ['--jpg-quality', '-1'], ['--jpg-quality', '10'],
        ['--png-quality-min', '90', '--png-quality-max', '20'],
        ['--png-quality-min', '81'], ['--png-quality-max', '49'],
    ];
    for (const flag of flags) {
        invalid.push([flag], [flag, '3', flag, '3']);
        for (const value of ['1.5', 'NaN', '1x', 'Infinity', '1e1', '0x5', '', '+3', ' 3', '3\n', '5\r\n']) {
            invalid.push([flag, value]);
        }
    }
    for (const [index, args] of invalid.entries()) {
        const output = path.join(root, `output-${index}`);
        const result = spawnSync(process.execPath, [
            path.join(projectRoot, 'resource-core/compress.js'), selected, '--output', output, ...args,
        ], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000 });
        assert.ifError(result.error);
        assert.equal(result.status, 1, `${JSON.stringify(args)}: ${result.stdout}\n${result.stderr}`);
        assert.ok(result.stderr.trim(), `missing error for ${JSON.stringify(args)}`);
        assert.equal(fs.existsSync(output), false, JSON.stringify(args));
    }
    assert.deepEqual(snapshotFiles(selected), before);
});

test('CLI forwards custom values and preserves save-as originals', windowsOnly, t => {
    const root = temporaryRoot(t);
    const selected = path.join(root, '自定义 原图');
    fs.mkdirSync(selected);
    const files = createImages(selected, [
        { name: '子目录/image.PNG', width: 220, height: 160, color: [200, 30, 30] },
        { name: '子目录/photo.JPG', width: 320, height: 240, color: [30, 180, 30] },
    ]);
    const before = snapshotFiles(selected);
    const options = { pngSpeed: 2, pngQualityMin: 20, pngQualityMax: 75, jpgQuality: 7 };
    const expectedOutput = path.join(root, 'expected');
    const expectedSummary = compressFolder(selected, { ...options, outputDir: expectedOutput, log() {} });
    assert.equal(expectedSummary.failed, 0);
    assert.equal(expectedSummary.compressed, files.length);
    const expectedHashes = snapshotFiles(expectedOutput);
    const cliOutput = path.join(root, 'CLI 输出');
    const cli = spawnSync(process.execPath, [
        path.join(projectRoot, 'resource-core/compress.js'), selected, '--output', cliOutput,
        '--png-speed', '2', '--png-quality-min', '20', '--png-quality-max', '75', '--jpg-quality', '7',
    ], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 120000 });
    assert.ifError(cli.error);
    assert.equal(cli.status, 0, `${cli.stdout}\n${cli.stderr}`);
    assert.deepEqual(snapshotFiles(cliOutput), expectedHashes);
    assert.deepEqual(snapshotFiles(selected), before);
    assert.equal(inspectImages(root, files).length, files.length);
});
