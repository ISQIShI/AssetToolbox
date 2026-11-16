import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { pickOption } from './native-select';
const require = createRequire(import.meta.url);
const project = fileURLToPath(new URL('../../', import.meta.url));

test('native source and step filters use real image properties and preserve excluded sources', async ({}, info) => {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-filters-native-'));
    const tool = require(path.join(project, 'resource-core/tests/portable')).copyTool(root, true);
    const source = path.join(root, '素材'), output = path.join(root, '输出'); fs.mkdirSync(source);
    fs.mkdirSync(path.join(tool, 'runtime')); fs.copyFileSync(path.join(project, 'runtime/node.exe'), path.join(tool, 'runtime/node.exe'));
    fs.copyFileSync(path.join(project, 'AssetToolbox.exe'), path.join(tool, 'AssetToolbox.exe'));
    const sharp = require(path.join(project, 'resource-core/node_modules/sharp'));
    await sharp({ create: { width: 80, height: 40, channels: 3, background: '#445566' } }).jpeg().toFile(path.join(source, 'large.jpg'));
    await sharp({ create: { width: 20, height: 10, channels: 3, background: '#445566' } }).jpeg().toFile(path.join(source, 'small.jpg'));
    await sharp({ create: { width: 80, height: 40, channels: 3, background: '#445566' } }).png().toFile(path.join(source, 'large.png'));
    const originals = fs.readdirSync(source).map(name => [name, fs.readFileSync(path.join(source, name))] as const);
    const settings = require(path.join(tool, 'resource-core/settings'));
    const step = (id: string, width: number) => ({ id, resourceType: 'jpg', operation: 'image-resize', provider: 'sharp', enabled: true, parameters: { width, height: width }, providerOptions: {} });
    settings.saveConfiguration({ ...settings.defaultConfiguration(), sourceDir: source, outputDir: output, saveMode: 'saveAs', pipeline: [step('first', 20), step('second', 10)] });
    let child: ChildProcess | undefined, browser: Browser | undefined, page: Page | undefined;
    try {
        const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve()));
        child = spawn(path.join(tool, 'AssetToolbox.exe'), [], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, ASSET_TOOLBOX_TEST_PORT: String(port), WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'webview') } });
        await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); page = browser.contexts()[0]!.pages()[0]!;
        const sourceEditor = page.getByRole('region', { name: '来源过滤', exact: true });
        await sourceEditor.getByRole('button', { name: '添加过滤条件', exact: true }).click();
        await pickOption(page!, sourceEditor, '属性 1-1', 'resource-type');
        await pickOption(page!, sourceEditor, '值 1-1', 'jpg');
        await sourceEditor.getByRole('button', { name: '且：添加条件', exact: true }).click();
        await pickOption(page!, sourceEditor, '属性 1-2', 'image-width');
        await pickOption(page!, sourceEditor, '比较 1-2', 'gt');
        await sourceEditor.getByLabel('值 1-2', { exact: true }).fill('40');
        await page.setViewportSize({ width: 1220, height: 850 });
        await page.evaluate(() => document.documentElement.dataset.theme = 'light');
        await page.screenshot({ path: info.outputPath('source-filters-1220-light.png') });
        await page.setViewportSize({ width: 840, height: 620 });
        await page.evaluate(() => document.documentElement.dataset.theme = 'dark');
        await page.screenshot({ path: info.outputPath('source-filters-840-dark.png') });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.locator('.rail [data-step-id="second"] button').click();
        const stepEditor = page.getByRole('region', { name: '步骤过滤', exact: true });
        await stepEditor.getByRole('button', { name: '添加过滤条件', exact: true }).click();
        await pickOption(page!, stepEditor, '属性 1-1', 'image-width');
        await pickOption(page!, stepEditor, '比较 1-1', 'gt');
        await stepEditor.getByLabel('值 1-1', { exact: true }).fill('30');
        await page.screenshot({ path: info.outputPath('step-filters-840-dark.png') });
        await page.getByRole('button', { name: '扫描预览', exact: true }).click();
        await expect(page.getByRole('heading', { name: '扫描结果', exact: true })).toBeVisible();
        await expect(page.locator('.scan')).toContainText('来源条件排除 2 个');
        await page.getByRole('button', { name: '开始处理', exact: true }).click();
        await expect(page.locator('.dock')).toHaveAttribute('data-state', 'done');
        await expect(page.locator('.dock')).toContainText('已完成');
        expect(fs.readdirSync(output)).toEqual(['large.jpg']);
        const metadata = await sharp(path.join(output, 'large.jpg')).metadata(); expect([metadata.width, metadata.height]).toEqual([20, 10]);
        for (const [name, bytes] of originals) expect(fs.readFileSync(path.join(source, name))).toEqual(bytes);
        const saved = settings.loadConfiguration(); expect(saved.sourceFilter.any[0].all).toHaveLength(2); expect(saved.pipeline[1].filter.any[0].all[0].value).toBe(30);
        const jobId = await page.locator('.dock').getAttribute('data-job-id');
        const { ApplicationService } = require(path.join(tool, 'resource-core/application/service'));
        const observer = ApplicationService.forDesktop();
        try { expect(observer.results(jobId, 'files', {}).items[0].steps.map((step: { status: string }) => step.status)).toEqual(['processed', 'filtered']); }
        finally { await observer.shutdown(); }
        await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })).catch(() => {});
        await expect.poll(() => child!.exitCode).not.toBeNull();
    } catch (error) { await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); throw error; }
    finally {
        await browser?.close();
        if (child && child.exitCode === null) { const closed = new Promise<void>(resolve => child!.once('close', () => resolve())); child.kill(); await closed; }
        expect(path.dirname(fs.realpathSync(root))).toBe(parent); expect(path.basename(root).startsWith('asset-filters-native-')).toBe(true);
        await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
});
