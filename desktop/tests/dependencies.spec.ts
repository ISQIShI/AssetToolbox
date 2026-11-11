// 显式联网验收：真实来源、摘要、安装、更新与新安装的实际处理。普通原生回归不运行本文件。
import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
const require = createRequire(import.meta.url);
const project = fileURLToPath(new URL('../../', import.meta.url));

test('verified online dependency install/update and actual processing with managed Sharp', async ({}, info) => {
    test.setTimeout(600000);
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-network-test-'));
    const tool = require(path.join(project, 'resource-core/tests/portable')).copyTool(root, true);
    let child: ChildProcess | undefined, browser: Browser | undefined, page: Page | undefined;
    try {
        fs.mkdirSync(path.join(tool, 'runtime')); fs.copyFileSync(path.join(project, 'runtime/node.exe'), path.join(tool, 'runtime/node.exe'));
        fs.copyFileSync(path.join(project, 'AssetToolbox.exe'), path.join(tool, 'AssetToolbox.exe'));
        const source = path.join(root, '素材'), output = path.join(root, '结果'); fs.mkdirSync(source);
        const sharp = require(path.join(project, 'resource-core/node_modules/sharp'));
        await sharp({ create: { width: 40, height: 20, channels: 4, background: '#445588' } }).png().toFile(path.join(source, 'image.png'));
        const settings = require(path.join(tool, 'resource-core/settings'));
        settings.saveConfiguration({ ...settings.defaultConfiguration(), sourceDir: source, outputDir: output, saveMode: 'saveAs', pipeline: [{ id: 'resize', resourceType: 'png', operation: 'image-resize', provider: 'sharp', enabled: true, parameters: { width: 10, height: 10 }, providerOptions: {} }] });
        fs.renameSync(path.join(tool, 'resource-core/node_modules'), path.join(tool, 'resource-core/node_modules.manual'));
        for (const name of ['lame.exe', 'libmpg123-0.dll']) fs.renameSync(path.join(tool, 'resource-core/providers/lame', name), path.join(tool, 'resource-core/providers/lame', name + '.manual'));
        const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve()));
        child = spawn(path.join(tool, 'AssetToolbox.exe'), [], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, ASSET_TOOLBOX_TEST_PORT: String(port), WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'webview') } });
        await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        page = browser.contexts()[0]!.pages()[0]!;
        const tab = (name: string) => page!.getByRole('navigation', { name: '工作区' }).getByRole('button', { name, exact: false });
        await tab('工具').click();
        await page.screenshot({ path: info.outputPath('dependency-missing.png') });
        for (const id of ['lame', 'sharp']) {
            const provider = page.locator(`[data-provider-id="${id}"]`);
            await expect(provider).toContainText('缺少依赖');
            await provider.getByRole('button', { name: '获取并安装', exact: true }).click();
            await expect(page.locator('.dock')).toHaveAttribute('data-state', 'done', { timeout: id === 'sharp' ? 330000 : 75000 });
            await expect(page.locator('.dock')).toContainText('已安装并通过完整性校验');
            await expect(provider).toContainText('已安装核验版本'); await expect(provider.locator('.state')).toHaveText('可用');
            await page.getByRole('button', { name: '关闭作业结果' }).click();
        }
        const record = path.join(tool, 'resource-core/data/dependencies/lame/active.json'), previous = JSON.parse(fs.readFileSync(record, 'utf8'));
        fs.writeFileSync(record, JSON.stringify({ ...previous, catalogHash: 'previous-approved-catalog' }));
        await page.getByRole('button', { name: '刷新依赖状态' }).click();
        const lame = page.locator('[data-provider-id="lame"]');
        if (await lame.locator('details').getAttribute('open') === null) await lame.locator('summary').click();
        await lame.getByRole('button', { name: '更新到核验版本', exact: true }).click();
        await expect(page.locator('.dock')).toHaveAttribute('data-state', 'done', { timeout: 75000 });
        await expect(page.locator('.dock')).toContainText('已安装并通过完整性校验');
        expect(JSON.parse(fs.readFileSync(record, 'utf8')).directory).not.toBe(previous.directory);
        expect(fs.existsSync(path.join(tool, 'resource-core/data/dependencies/lame/installs', previous.directory))).toBe(true);
        await page.screenshot({ path: info.outputPath('dependency-updated.png') });
        await page.getByRole('button', { name: '关闭作业结果' }).click();
        await tab('处理').click(); await page.getByRole('button', { name: '开始处理', exact: true }).click();
        await expect(page.locator('.dock')).toHaveAttribute('data-state', 'done');
        const resized = await sharp(path.join(output, 'image.png')).metadata(); expect([resized.width, resized.height]).toEqual([10, 5]);
        expect((await sharp(path.join(source, 'image.png')).metadata()).width).toBe(40);
        await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })).catch(() => {});
        await expect.poll(() => child!.exitCode, { timeout: 15000 }).not.toBeNull();
    } catch (error) { await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); throw error; }
    finally {
        await browser?.close();
        if (child && child.exitCode === null) { const exited = new Promise<void>(resolve => child!.once('exit', () => resolve())); child.kill(); await exited; }
        assertTemporary();
        await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
    function assertTemporary() { expect(path.dirname(fs.realpathSync(root))).toBe(parent); expect(path.basename(root).startsWith('asset-network-test-')).toBe(true); }
});
