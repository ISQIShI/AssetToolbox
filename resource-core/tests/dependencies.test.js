const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { download, validateUrl } = require('../framework/dependencies/download');
const { tar, zip } = require('../framework/dependencies/archive');
const { install } = require('../framework/dependencies/install');
const { active, management, fingerprint, runtimeDirectory } = require('../framework/dependencies/runtime');
const { safePath, hash } = require('../framework/dependencies/paths');
const { DesktopBridge } = require('../desktop-bridge');

function temporary(t) { const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'asset-dependency-test-')); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
const digest = bytes => 'sha512-' + crypto.createHash('sha512').update(bytes).digest('base64');
const artifact = bytes => ({ url: 'https://registry.npmjs.org/test/-/test-1.0.0.tgz', integrity: digest(bytes) });
function response(bytes, statusCode = 200, headers = {}) { return Object.assign(Readable.from([bytes]), { statusCode, headers }); }
function tgz(files) {
    const chunks = [];
    for (const [name, value, type = '0'] of files) {
        const content = Buffer.from(value), header = Buffer.alloc(512);
        header.write(name); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
        header.write(content.length.toString(8).padStart(11, '0') + '\0', 124); header.fill(32, 148, 156); header.write(type, 156);
        header.write('ustar\0', 257); header.write('00', 263);
        header.write(header.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
        chunks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
    }
    return zlib.gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
function simpleZip(name, bytes) {
    const n = Buffer.from(name), local = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
    local.writeUInt32LE(0x04034b50); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(n.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(n.length, 28);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(30 + n.length + bytes.length, 16);
    return Buffer.concat([local, n, bytes, central, n, end]);
}

test('downloads accept pinned HTTPS sources only and verify digest before returning bytes', async () => {
    const bytes = Buffer.from('verified payload'), source = artifact(bytes);
    assert.deepEqual(await download(source, { getResponse: async () => response(bytes) }), bytes);
    for (const url of ['http://registry.npmjs.org/file', 'https://registry.npmjs.org.evil.test/file', 'https://user:pass@registry.npmjs.org/file', 'https://127.0.0.1/file', 'https://registry.npmjs.org:444/file']) assert.throws(() => validateUrl(url), /来源/);
    await assert.rejects(download(source, { getResponse: async () => response(Buffer.from('tampered')) }), /完整性/);
    await assert.rejects(download(source, { getResponse: async () => response(bytes, 302, { location: 'https://evil.test' }) }), /重定向/);
    await assert.rejects(download(source, { maxBytes: 3, getResponse: async () => response(bytes) }), /上限/);
    await assert.rejects(download({ ...source, integrity: '' }), /摘要/);
    const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await assert.rejects(download(source, { signal: controller.signal, getResponse: () => assert.fail('must not request') }), /cancelled/);
});

test('TAR extracts regular files and rejects traversal, links, duplicates, bad checksum and oversized output', t => {
    const root = temporary(t);
    tar(tgz([['package/lib/a.js', 'hello']]), root, 'node_modules/test');
    assert.equal(fs.readFileSync(path.join(root, 'node_modules/test/lib/a.js'), 'utf8'), 'hello');
    for (const files of [[['package/../../escape', 'bad']], [['package/link', 'bad', '2']], [['package/a', '1'], ['package/A', '2']]]) assert.throws(() => tar(tgz(files), temporary(t), 'node_modules/test'));
    const broken = zlib.gunzipSync(tgz([['package/a', 'x']])); broken[0] ^= 1;
    assert.throws(() => tar(zlib.gzipSync(broken), temporary(t), 'x'), /校验/);
    assert.throws(() => tar(zlib.gzipSync(Buffer.alloc(129 * 1024 * 1024)), temporary(t), 'x'));
    for (const name of ['../x', '/x', 'C:/x', 'a\\x', 'nul.txt', 'a./b', 'x:stream']) assert.throws(() => safePath(root, name), /路径/);
});

test('ZIP writes only enumerated files and checks their hashes', t => {
    const root = temporary(t), bytes = Buffer.from('binary fixture');
    zip(simpleZip('lame.exe', bytes), root, { 'lame.exe': hash(bytes) });
    assert.deepEqual(fs.readFileSync(path.join(root, 'lame.exe')), bytes);
    assert.throws(() => zip(simpleZip('../escape.exe', bytes), temporary(t), {}), /路径/);
    assert.throws(() => zip(simpleZip('lame.exe', bytes), temporary(t), { 'lame.exe': '0'.repeat(64) }), /摘要/);
    assert.throws(() => zip(simpleZip('other.exe', bytes), temporary(t), { 'lame.exe': hash(bytes) }), /缺少/);
});

test('staged installs preserve originals; failed updates, cancellation and failed probes preserve active version', async t => {
    const root = temporary(t), bytes = tgz([['package/content', 'version one']]);
    const plan = { version: '4.0', artifacts: [{ ...artifact(bytes), format: 'tgz', target: 'payload' }] };
    const options = { root, plan, fetchArtifact: async () => bytes, probe: () => {} };
    fs.mkdirSync(path.join(root, 'providers/lame'), { recursive: true }); fs.writeFileSync(path.join(root, 'providers/lame/lame.exe'), 'manual');
    const first = await install('lame', options), directory = active('lame', root).directory;
    assert.equal(fs.readFileSync(path.join(directory, 'payload/content'), 'utf8'), 'version one');
    assert.equal(fs.readFileSync(path.join(root, 'providers/lame/lame.exe'), 'utf8'), 'manual');
    await assert.rejects(install('lame', { ...options, fetchArtifact: async () => { throw Error('network'); } }), /network/);
    await assert.rejects(install('lame', { ...options, probe: () => { throw Error('load failed'); } }), /load failed/);
    await assert.rejects(install('lame', { ...options, checkCancellation: () => { throw Error('cancelled'); } }), /cancelled/);
    const controller = new AbortController();
    await assert.rejects(install('lame', { ...options, signal: controller.signal, probe: () => controller.abort(new Error('cancel during probe')) }), /cancel during probe/);
    assert.equal(active('lame', root).directory, directory);
    assert.equal(fs.readdirSync(path.dirname(directory)).length, 1);
    const next = await install('lame', { ...options, plan: { ...plan, version: '4.1' } });
    assert.notEqual(next.directory, first.directory); assert.equal(active('lame', root).version, '4.1');
    assert.equal(fs.existsSync(directory), true);
    assert.equal(management('lame', root).automatic, false); // 不自动降级。
    assert.throws(() => runtimeDirectory({ id: 'lame', directory: path.join(root, 'providers/lame') }), /不匹配/);
    fs.appendFileSync(path.join(active('lame', root).directory, 'payload/content'), 'tampered');
    assert.throws(() => active('lame', root), /完整性/);
    assert.equal(management('lame', root).action, 'repair');
});

test('current versus changed approved catalog is explicit and unknown requests cannot inject URLs or paths', async t => {
    const root = temporary(t), bytes = tgz([['package/content', 'ok']]);
    const plan = { version: '4.0', artifacts: [{ ...artifact(bytes), format: 'tgz', target: 'payload' }] };
    await install('lame', { root, plan, fetchArtifact: async () => bytes, probe: () => {} });
    assert.equal(management('lame', root).state, 'update');
    const file = path.join(root, 'data/dependencies/lame/active.json'), record = JSON.parse(fs.readFileSync(file));
    record.catalogHash = fingerprint(require('../framework/dependencies/catalog.json').providers.lame); fs.writeFileSync(file, JSON.stringify(record));
    assert.equal(management('lame', root).state, 'current');
    const bridge = new DesktopBridge();
    for (const request of [{ mode: 'dependency-install', providerId: 'lame', url: 'https://evil.test' }, { mode: 'dependency-install', providerId: '../lame' }, { mode: 'dependency-install', providerId: '__proto__' }, { mode: 'dependency-install', providerId: 'jpg-c' }]) await assert.rejects(bridge.dispatch('start', request));
    bridge.job = { exited: false }; await assert.rejects(bridge.dispatch('start', { mode: 'dependency-install', providerId: 'lame' }), /等待/);
    assert.equal(management('pngquant', root).automatic, false); assert.equal(management('jpg-c', root).automatic, false);
});

test('managed files cannot traverse directory junctions or symbolic links', t => {
    const root = temporary(t), outside = temporary(t);
    fs.mkdirSync(path.join(root, 'data'));
    fs.symlinkSync(outside, path.join(root, 'data/dependencies'), 'junction');
    assert.throws(() => active('lame', root), /链接/);
    assert.equal(fs.readdirSync(outside).length, 0);
});

test('installation worker observes cancellation before downloading and publishes a final state', async t => {
    const root = temporary(t), tool = require('./portable').copyTool(root);
    const job = path.join(root, 'job'); fs.mkdirSync(job);
    fs.writeFileSync(path.join(job, 'request.json'), JSON.stringify({ mode: 'dependency-install', providerId: 'sharp' }));
    fs.writeFileSync(path.join(job, 'cancel'), '');
    const child = require('node:child_process').spawn(process.execPath, [path.join(tool, 'resource-core/framework/dependencies/worker.js'), path.join(job, 'request.json')], { windowsHide: true, stdio: 'ignore' });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.equal(code, 2);
    const state = JSON.parse(fs.readFileSync(path.join(job, 'status.json')));
    assert.equal(state.done, true); assert.equal(state.cancelled, true); assert.equal(state.exitCode, 2);
    assert.equal(fs.existsSync(path.join(tool, 'resource-core/data/dependencies/sharp/active.json')), false);
});

test('approved catalog matches the committed package lock and provenance hashes', () => {
    const plans = require('../framework/dependencies/catalog.json').providers;
    const lock = require('../package-lock.json'), provenance = require('../../third-party/provider-artifacts.json');
    for (const item of plans.sharp.artifacts) {
        assert.equal(item.url, lock.packages[item.target].resolved);
        assert.equal(item.integrity, lock.packages[item.target].integrity);
        validateUrl(item.url);
    }
    assert.equal(plans.sharp.version, lock.packages['node_modules/sharp'].version);
    assert.deepEqual(plans.sharp.artifacts.map(a => a.target).sort(), ['sharp', '@img/sharp-win32-x64', '@img/colour', 'detect-libc', 'semver'].map(name => 'node_modules/' + name).sort());
    assert.deepEqual(plans.lame.artifacts[0].files, provenance.lame.files);
    assert.equal(Buffer.from(plans.lame.artifacts[0].integrity.slice(7), 'base64').toString('hex'), provenance.lame.archiveSha256);
});
