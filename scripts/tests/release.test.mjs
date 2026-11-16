import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, parseVersion, compareVersions, checkVersions, setVersion } from '../version.mjs';
import { releasePlan, publishRelease } from '../release.mjs';

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-release-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    for (const name of ['VERSION', ...['resource-core', 'desktop', 'agent-mcp'].flatMap(dir => [`${dir}/package.json`, `${dir}/package-lock.json`]), ...['Cargo.toml', 'Cargo.lock', 'tauri.conf.json'].map(file => `desktop/src-tauri/${file}`)]) {
        fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
        fs.copyFileSync(path.join(root, name), path.join(directory, name));
    }
    const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    return { directory, git };
}
function repository(t) {
    const result = fixture(t), { directory, git } = result;
    setVersion('1.2.0-rc.1', directory);
    fs.mkdirSync(path.join(directory, 'docs/releases'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'docs/releases/1.2.0-rc.1.md'), '# v1.2.0-rc.1\n\n## 变更\n修复缺陷。\n## 兼容性\n不变。\n## 验证\n源码通过；原生未执行。\n## 获取与限制\n仅源码。\n');
    git('init', '-b', 'main'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Release Test');
    git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-m', 'test: 生成隔离发布夹具');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD'); git('tag', 'v1.2.0-rc.1');
    return result;
}
test('版本接受有限 SemVer 形式，拒绝路径/前导零/不安全数字，排序符合预发布语义', () => {
    for (const value of ['1.2.3', '0.1.0-alpha.1', '1.0.0-beta.2', '1.0.0-rc.10']) assert.equal(parseVersion(value).value, value);
    for (const value of ['v1.0.0', '../1.0.0', '1.00.0', '1.0.0-rc.0', '1.0.0-rc.01', '1.0.0+build', '1.0.0-preview.1', '9007199254740992.0.0']) assert.throws(() => parseVersion(value));
    const ordered = ['1.0.0-alpha.1', '1.0.0-beta.1', '1.0.0-rc.2', '1.0.0-rc.10', '1.0.0', '1.0.1', '1.1.0', '2.0.0'];
    for (let i = 1; i < ordered.length; i++) assert.equal(compareVersions(ordered[i - 1], ordered[i]), -1);
});
test('统一更新九个清单及 VERSION，不改依赖版本；不一致先拒绝写入', t => {
    const { directory } = fixture(t);
    const lockFile = path.join(directory, 'desktop/package-lock.json');
    const dependency = JSON.parse(fs.readFileSync(lockFile)).packages['node_modules/vue'].version;
    assert.equal(setVersion('2.0.0-rc.1', directory), '2.0.0-rc.1');
    assert.equal(JSON.parse(fs.readFileSync(lockFile)).packages['node_modules/vue'].version, dependency);
    fs.writeFileSync(path.join(directory, 'VERSION'), '3.0.0\n');
    assert.throws(() => checkVersions(directory), /不一致/);
    const before = fs.readFileSync(lockFile, 'utf8');
    assert.throws(() => setVersion('3.1.0', directory)); assert.equal(fs.readFileSync(lockFile, 'utf8'), before);
});
test('标签、main 归属、递增版本与人工版本说明均为发布门槛', t => {
    const { directory, git } = repository(t);
    const plan = releasePlan('v1.2.0-rc.1', directory);
    assert.equal(plan.prerelease, true); assert.equal(plan.sha, git('rev-parse', 'HEAD'));
    assert.throws(() => releasePlan('v1.2.0', directory), /标签/);
    git('tag', 'v2.0.0'); assert.throws(() => releasePlan(plan.tag, directory), /高于/); git('tag', '-d', 'v2.0.0');
    git('update-ref', '-d', 'refs/remotes/origin/main'); assert.throws(() => releasePlan(plan.tag, directory));
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const note = path.join(directory, 'docs/releases/1.2.0-rc.1.md'), original = fs.readFileSync(note, 'utf8');
    fs.writeFileSync(note, original.replace('修复缺陷。', ''));
    assert.throws(() => releasePlan(plan.tag, directory), /空章节/);
    fs.writeFileSync(note, original.replace(/\n/g, '\r\n'));
    assert.equal(releasePlan(plan.tag, directory).prerelease, true);
    fs.appendFileSync(note, '\n待填写');
    assert.throws(() => releasePlan(plan.tag, directory), /占位/);
});

function fakeApi({ isPrivate = false, remoteSha = 'abc', existing = null, failure = false } = {}) {
    const calls = [];
    return { calls, request: async (url, options) => {
        calls.push({ url, ...options });
        if (options.method === 'POST') return new Response(JSON.stringify({ html_url: 'https://github.com/test/repo/releases/tag/v1.2.0' }), { status: failure ? 500 : 201 });
        if (url.endsWith('/test/repo')) return Response.json({ private: isPrivate });
        if (url.includes('/commits/')) return Response.json({ sha: remoteSha });
        return existing ? Response.json(existing) : new Response('', { status: 404 });
    } };
}
const plan = { tag: 'v1.2.0', sha: 'abc', notes: '# v1.2.0\n\n发布说明', prerelease: false };
const context = { repository: 'test/repo', token: 'test-secret', runId: '123' };
test('只创建源码 Release，预发布不替换 Latest，已发布重跑不覆盖', async () => {
    for (const prerelease of [false, true]) {
        const api = fakeApi();
        assert.equal((await publishRelease({ ...plan, prerelease }, { ...context, ...api })).status, 'published');
        const request = api.calls.find(call => call.method === 'POST'), body = JSON.parse(request.body);
        assert.equal(body.prerelease, prerelease); assert.equal(body.make_latest, prerelease ? 'false' : 'legacy');
        assert.match(body.body, /仅提供 GitHub/); assert.equal(body.draft, false);
        assert.equal(api.calls.some(call => call.url.includes('/assets')), false);
        const again = fakeApi({ existing: { ...body, html_url: 'https://github.com/test/repo/releases/tag/v1.2.0' } });
        assert.equal((await publishRelease({ ...plan, prerelease }, { ...context, ...again })).status, 'already-published');
        assert.equal(again.calls.some(call => call.method !== 'GET'), false);
    }
});
test('非公开仓库、移动标签、外来 Release 或网络错误均不静默写入/覆盖', async () => {
    for (const options of [{ isPrivate: true }, { isPrivate: null }, { remoteSha: 'changed' }, { existing: { body: 'foreign' } }]) {
        const api = fakeApi(options);
        await assert.rejects(publishRelease(plan, { ...context, ...api }));
        assert.equal(api.calls.some(call => call.method !== 'GET'), false);
    }
    await assert.rejects(publishRelease(plan, { ...context, ...fakeApi({ failure: true }) }), error => !error.message.includes('test-secret') && /HTTP 500/.test(error.message));
});
