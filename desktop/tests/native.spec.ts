import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
const require = createRequire(import.meta.url);
const project = fileURLToPath(new URL('../../', import.meta.url));
const { copyTool } = require(path.join(project, 'resCompress/tests/portable.js'));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort(): Promise<number> { const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port; }
test('native portable app: config + dynamic modules + save-as + cancel/resume/retry + selective restore + relaunch', async ({}, info) => {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'compress-native-test-'));
    const tool = copyTool(root), source = path.join(root, '中文 素材'), backup = path.join(root, '原图备份'), output = path.join(root, '另存 结果');
    fs.mkdirSync(path.join(tool, 'runtime')); fs.copyFileSync(path.join(project, 'runtime/node.exe'), path.join(tool, 'runtime/node.exe'));
    fs.copyFileSync(path.join(project, 'ResourceCompressor.exe'), path.join(tool, 'ResourceCompressor.exe'));
    fs.copyFileSync(path.join(project, 'resCompress/desktop-bridge.js'), path.join(tool, 'resCompress/desktop-bridge.js'));
    const module = path.join(tool, 'resCompress/compressors/extra'); fs.mkdirSync(module);
    fs.writeFileSync(path.join(module, 'config.js'), 'module.exports=' + JSON.stringify({ displayName: '扩展测试模块', order: 5, extensions: ['.pack'], enabledKey: 'extraEnabled', defaults: { extraEnabled: true, extraLevel: 3, extraMode: 'fast', extraText: '原参数' }, limits: { extraLevel: { label: '测试级别', min: 1, max: 9 } }, parameters: { extraMode: { label: '测试模式', type: 'enum', choices: ['fast', 'best'] }, extraText: { label: '测试文字', type: 'text', maxLength: 32767 } } }));
    fs.writeFileSync(path.join(module, 'index.js'), `const fs=require('node:fs'),path=require('node:path');module.exports={validate:b=>b.toString().startsWith('PACK:'),compress({input,output}){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);const bytes=fs.readFileSync(input);fs.appendFileSync(path.join(__dirname,'calls.txt'),bytes.subarray(0,6)+'\\n');if(bytes.toString().startsWith('PACK:b')&&!fs.existsSync(path.join(__dirname,'repaired')))throw Error('模拟编码失败');fs.writeFileSync(output,bytes.subarray(0,10));return{output};}}`);
    fs.mkdirSync(path.join(source, '二级'), { recursive: true });
    const originals = new Map<string, Buffer>();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) { const data = Buffer.from('PACK:' + name + 'x'.repeat(4000)); const relative = path.join('二级', name + '.pack'); originals.set(relative, data); fs.writeFileSync(path.join(source, relative), data); }
    const legacy = { version: 1, sourceDir: source, outputDir: output, backupDir: backup, saveMode: 'saveAs', backupEnabled: true, extraEnabled: true, extraLevel: 6, extraMode: 'best', extraText: '中文 历史配置', pngEnabled: false, jpgEnabled: false, mp3Enabled: false };
    fs.writeFileSync(path.join(tool, 'resCompress/user-settings.json'), '\uFEFF' + JSON.stringify(legacy));
    let child: ChildProcess | undefined, browser: Browser | undefined, page!: Page;
    const errors: string[] = [];
    async function launch() {
        const port = await freePort();
        child = spawn(path.join(tool, 'ResourceCompressor.exe'), [], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, RESOURCE_COMPRESSOR_TEST_PORT: String(port), WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'webview') } });
        await expect.poll(async () => { try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); return response.ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        await expect.poll(() => browser!.contexts()[0]?.pages().length || 0).toBeGreaterThan(0);
        page = browser.contexts()[0].pages()[0]; page.on('pageerror', error => errors.push(error.message));
        await expect(page.getByRole('heading', { name: '让资源更轻一点' })).toBeVisible();
        await expect(page.getByLabel('源文件夹', { exact: true })).toHaveValue(source);
    }
    let observedJob = '';
    async function started() {
        await expect.poll(async () => (await page.locator('.job-panel').getAttribute('data-job-id')) || observedJob).not.toBe(observedJob);
        observedJob = (await page.locator('.job-panel').getAttribute('data-job-id'))!;
    }
    async function done(alreadyStarted = false) { if (!alreadyStarted) await started(); await expect(page.locator('.job-panel .eyebrow')).not.toHaveText('PROCESSING', { timeout: 30000 }); }
    async function close() {
        await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })).catch(cause => { if (!/closed|destroyed/i.test(String(cause))) throw cause; });
        await expect.poll(() => child!.exitCode, { timeout: 15000, message: 'Native close must release the host process: ' + errors.join('; ') }).not.toBeNull();
        await browser?.close(); browser = undefined; child = undefined;
    }
    try {
        await launch();
        await expect(page.getByLabel('测试级别', { exact: false })).toHaveValue('6');
        await expect(page.getByLabel('测试文字', { exact: true })).toHaveValue('中文 历史配置');
        expect(fs.existsSync(path.join(tool, 'resCompress/config'))).toBe(false);
        await page.screenshot({ path: info.outputPath('workspace.png'), fullPage: true });
        await page.setViewportSize({ width: 840, height: 620 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath('compact.png'), fullPage: true });
        await page.setViewportSize({ width: 1220, height: 850 });
        await page.getByRole('button', { name: '扫描预览', exact: true }).click();
        await expect(page.getByRole('heading', { name: '扫描结果', exact: true })).toBeVisible();
        await expect(page.locator('.job-panel')).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('scan-result.png'), fullPage: true });
        for (const name of ['任务历史', '备份恢复']) {
            await page.getByRole('navigation').getByRole('button', { name, exact: false }).click();
            await expect(page.locator('.job-panel')).toHaveCount(0);
            await expect(page.getByRole('heading', { name: '扫描结果', exact: true })).toHaveCount(0);
            await page.screenshot({ path: info.outputPath(name === '任务历史' ? 'preview-history.png' : 'preview-restore.png'), fullPage: true });
        }
        await page.getByRole('navigation').getByRole('button', { name: '压缩资源', exact: false }).click();
        expect(fs.existsSync(path.join(tool, 'resCompress/config'))).toBe(false);
        expect(fs.existsSync(path.join(tool, 'resCompress/tasks'))).toBe(false);
        await page.getByRole('button', { name: '开始压缩', exact: false }).click(); await done();
        for (const [relative, original] of originals) expect(fs.readFileSync(path.join(source, relative))).toEqual(original);
        expect(fs.readFileSync(path.join(output, '二级/a.pack')).length).toBe(10);
        expect(fs.readFileSync(path.join(output, '二级/b.pack'))).toEqual(originals.get(path.join('二级/b.pack')));
        await page.getByRole('button', { name: '关闭任务结果', exact: true }).click();
        await expect(page.locator('.job-panel')).toHaveCount(0);
        await page.getByLabel('覆盖原文件', { exact: false }).check();
        await page.getByLabel('启用备份', { exact: false }).check();
        await page.getByRole('button', { name: '开始压缩', exact: false }).click();
        await started();
        await expect.poll(async () => { const text = await page.locator('.progress-caption').innerText(); return Number(text.split('/')[0].trim()); }).toBeGreaterThan(0);
        await page.getByRole('navigation').getByRole('button', { name: '任务历史', exact: false }).click();
        await page.getByRole('button', { name: '取消任务', exact: true }).click();
        await page.getByRole('navigation').getByRole('button', { name: '压缩资源', exact: false }).click(); await done(true);
        await page.getByRole('button', { name: '查看任务', exact: true }).click();
        await expect(page.getByRole('button', { name: '继续未完成', exact: true })).toBeEnabled();
        await page.getByRole('button', { name: '继续未完成', exact: true }).click(); await done();
        fs.writeFileSync(path.join(module, 'repaired'), '');
        await page.getByRole('button', { name: '仅重试压缩失败项', exact: true }).click(); await done();
        const calls = fs.readFileSync(path.join(module, 'calls.txt'), 'utf8').trim().split('\n');
        expect(calls.filter(line => line === 'PACK:a')).toHaveLength(2);
        expect(calls.filter(line => line === 'PACK:b')).toHaveLength(3);
        const conflict = path.join(source, '二级/a.pack'); fs.writeFileSync(conflict, '用户后来编辑的内容');
        await page.getByRole('button', { name: '预览备份与恢复', exact: true }).click();
        await expect(page.getByRole('heading', { name: '恢复前预览', exact: true })).toBeVisible();
        await expect(page.locator('.job-panel')).toHaveCount(0);
        await expect(page.getByLabel(`恢复 二级\\a.pack`, { exact: true })).toBeDisabled();
        await page.getByRole('button', { name: '取消筛选结果', exact: true }).click();
        await page.getByLabel(`恢复 二级\\c.pack`, { exact: true }).check();
        await page.getByLabel('搜索恢复文件').fill('b.pack');
        await expect(page.locator('.table-footer')).toContainText('1 项被筛选隐藏');
        await page.screenshot({ path: info.outputPath('restore.png'), fullPage: true });
        await page.getByRole('button', { name: '恢复所选 1 项', exact: true }).click(); await done();
        expect(fs.readFileSync(path.join(source, '二级/c.pack'))).toEqual(originals.get(path.join('二级/c.pack')));
        expect(fs.readFileSync(path.join(source, '二级/b.pack')).length).toBe(10);
        expect(fs.readFileSync(conflict, 'utf8')).toBe('用户后来编辑的内容');
        await close(); await launch();
        await expect(page.getByLabel('覆盖原文件', { exact: false })).toBeChecked();
        await expect(page.getByLabel('启用备份', { exact: false })).toBeChecked();
        expect(fs.readFileSync(path.join(tool, 'resCompress/user-settings.json'), 'utf8')).toContain('中文 历史配置');
        expect(errors).toEqual([]);
        await page.getByRole('button', { name: '开始压缩', exact: false }).click();
        await started();
        await expect.poll(async () => Number((await page.locator('.progress-caption').innerText()).split('/')[0].trim())).toBeGreaterThan(0);
        await close();
        const [lastTask] = require(path.join(tool, 'resCompress/tasks.js')).listTasks();
        expect(lastTask.canResume).toBe(true); expect(lastTask.pending).toBeGreaterThan(0);
    } catch (cause) {
        console.error('Native flow failed:', cause);
        await page?.screenshot({ path: info.outputPath('failure.png'), fullPage: true }).catch(() => {});
        throw cause;
    } finally {
        if (browser) await browser.close().catch(() => {});
        if (child && child.exitCode === null) { const exited = new Promise<void>(resolve => child!.once('exit', () => resolve())); child.kill(); await exited; }
        await sleep(1800);
        expect(path.dirname(fs.realpathSync(root))).toBe(parent); expect(path.basename(root).startsWith('compress-native-test-')).toBe(true);
        await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(cause => console.error('Temporary cleanup failed:', root, cause));
    }
});
