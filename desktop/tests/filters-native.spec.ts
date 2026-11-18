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

test('native image filters preserve sources and track the same job across a status outage and bridge restart', async ({}, info) => {
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
    // 只改隔离副本。桌面查询与实际 worker 分别由测试放行，CLI/核心观察者可独立读取真实作业。
    const statusGate = path.join(root, 'status-offline'), workerGate = path.join(root, 'worker-wait');
    const exitBridge = path.join(root, 'exit-bridge'), exitedPid = path.join(root, 'exited-pid'), resumedPid = path.join(root, 'resumed-pid');
    const submissions = path.join(root, 'process-submissions.txt');
    fs.appendFileSync(path.join(tool, 'resource-core/desktop-bridge.js'), `
        const fs = require('node:fs');
        const dispatch = DesktopBridge.prototype.dispatch;
        DesktopBridge.prototype.dispatch = function (action, payload) {
            if (action === 'submit' && payload.request.mode === 'process') fs.appendFileSync(${JSON.stringify(submissions)}, '1');
            if (action === 'status') {
                if (fs.existsSync(${JSON.stringify(exitBridge)}) && !fs.existsSync(${JSON.stringify(exitedPid)})) {
                    fs.writeFileSync(${JSON.stringify(exitedPid)}, String(process.pid));
                    process.exit(91);
                }
                if (fs.existsSync(${JSON.stringify(statusGate)})) throw Error('验收门闩阻断状态查询');
                if (fs.existsSync(${JSON.stringify(exitedPid)})) fs.writeFileSync(${JSON.stringify(resumedPid)}, String(process.pid));
            }
            return dispatch.call(this, action, payload);
        };`);
    fs.appendFileSync(path.join(tool, 'resource-core/providers/sharp/adapters/image-resize.js'), `
        const execute = module.exports.execute;
        module.exports.execute = function (input) {
            const signal = new Int32Array(new SharedArrayBuffer(4));
            const deadline = Date.now() + 60000;
            while (require('node:fs').existsSync(${JSON.stringify(workerGate)})) {
                if (Date.now() >= deadline) throw Error('验收门闩未释放 worker');
                Atomics.wait(signal, 0, 0, 25);
            }
            return execute.call(this, input);
        };`);
    let child: ChildProcess | undefined, browser: Browser | undefined, page: Page | undefined;
    try {
        const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve()));
        child = spawn(path.join(tool, 'AssetToolbox.exe'), [], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, ASSET_TOOLBOX_TEST_PORT: String(port), WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'webview') } });
        await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); page = browser.contexts()[0]!.pages()[0]!;
        const sourceEditor = page.getByRole('region', { name: '来源过滤', exact: true });
        await sourceEditor.getByRole('button', { name: '添加过滤条件', exact: true }).click();
        const property = sourceEditor.getByLabel('属性 1-1', { exact: true });
        const originalProperty = await property.textContent();
        for (const [width, height, theme] of [[1220, 850, 'light'], [840, 620, 'dark']] as const) {
            await page.setViewportSize({ width, height });
            await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
            if (width === 840) {
                const propertyRect = (await property.boundingBox())!;
                const operatorRect = (await sourceEditor.getByLabel('比较 1-1', { exact: true }).boundingBox())!;
                expect(propertyRect.y + propertyRect.height).toBeLessThanOrEqual(operatorRect.y);
                expect(propertyRect.width).toBeGreaterThan(operatorRect.width);
            }
            await property.focus(); await property.press('Enter');
            const branch = page.getByRole('menuitem', { name: '图片属性', exact: true });
            await branch.focus(); await branch.press('ArrowRight');
            await expect(page.locator('[data-value="image-width"]')).toBeVisible();
            await expect(property).toHaveText(originalProperty!);
            await page.screenshot({ path: info.outputPath(`filter-property-menu-${width}-${theme}.png`) });
            for (const popup of await page.locator('.cascade-popup:visible').all()) {
                const rect = (await popup.boundingBox())!;
                expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.y).toBeGreaterThanOrEqual(0);
                expect(rect.x + rect.width).toBeLessThanOrEqual(width); expect(rect.y + rect.height).toBeLessThanOrEqual(height);
            }
            await page.keyboard.press('ArrowLeft'); await expect(branch).toBeFocused();
            await page.keyboard.press('Escape'); await expect(property).toBeFocused();
            await expect(property).toHaveText(originalProperty!);
        }
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
        await expect(page.getByRole('complementary', { name: '概览' })).toContainText('来源条件排除 2 个');
        const start = page.getByRole('button', { name: '开始处理', exact: true });
        const dock = page.locator('.dock');
        fs.writeFileSync(workerGate, ''); fs.writeFileSync(statusGate, '');
        await start.click();
        await expect(dock).toHaveAttribute('data-job-id', /^[a-f0-9]{64}$/);
        const jobId = (await dock.getAttribute('data-job-id'))!;
        const { ApplicationService } = require(path.join(tool, 'resource-core/application/service'));
        const observer = ApplicationService.forDesktop();
        try {
            await expect(dock).toContainText(/暂时无法取得.*状态/);
            await expect(start).toBeDisabled();
            await expect(page.getByRole('button', { name: '关闭作业结果' })).toHaveCount(0);
            await expect.poll(() => fs.existsSync(path.join(tool, 'resource-core/data/jobs/v6', jobId, 'worker.json'))).toBe(true);
            expect(observer.status(jobId).done).toBe(false);
            await page.screenshot({ path: info.outputPath('job-status-offline-840-dark.png') });
            await page.setViewportSize({ width: 1220, height: 850 });
            await page.evaluate(() => document.documentElement.dataset.theme = 'light');
            await page.screenshot({ path: info.outputPath('job-status-offline-1220-light.png') });
            fs.unlinkSync(workerGate);
            await expect.poll(() => observer.status(jobId).done).toBe(true);
            expect(observer.status(jobId).exitCode).toBe(0);
            await expect(dock).toHaveAttribute('data-job-id', jobId);
            await expect(dock).toContainText(/暂时无法取得.*状态/);
            await expect(start).toBeDisabled();

            // 作业已由核心确认完成，桌面尚未知晓。让下一次 status 丢失响应并终止原桥接。
            fs.writeFileSync(exitBridge, '');
            await expect.poll(() => fs.existsSync(exitedPid)).toBe(true);
            fs.unlinkSync(statusGate);
            await expect(dock).toHaveAttribute('data-state', 'done', { timeout: 30000 });
            await expect(dock).toHaveAttribute('data-job-id', jobId);
            await expect(dock).toContainText('已完成');
            await expect(dock).not.toContainText(/暂时无法取得.*状态/);
            expect(fs.readFileSync(resumedPid, 'utf8')).not.toBe(fs.readFileSync(exitedPid, 'utf8'));
            expect(fs.readFileSync(submissions, 'utf8')).toBe('1');
            const processes = observer.dispatch('jobs', {}).items.filter((job: { mode: string }) => job.mode === 'process');
            expect(processes.map((job: { jobId: string }) => job.jobId)).toEqual([jobId]);
            expect(observer.results(jobId, 'files', {}).items[0].steps.map((step: { status: string }) => step.status)).toEqual(['processed', 'filtered']);
        } finally { await observer.shutdown(); }
        expect(fs.readdirSync(output)).toEqual(['large.jpg']);
        const metadata = await sharp(path.join(output, 'large.jpg')).metadata(); expect([metadata.width, metadata.height]).toEqual([20, 10]);
        for (const [name, bytes] of originals) expect(fs.readFileSync(path.join(source, name))).toEqual(bytes);
        const saved = settings.loadConfiguration(); expect(saved.sourceFilter.any[0].all).toHaveLength(2); expect(saved.pipeline[1].filter.any[0].all[0].value).toBe(30);
        await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })).catch(() => {});
        await expect.poll(() => child!.exitCode).not.toBeNull();
    } catch (error) { await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); throw error; }
    finally {
        fs.rmSync(workerGate, { force: true });
        await browser?.close();
        if (child && child.exitCode === null) { const closed = new Promise<void>(resolve => child!.once('close', () => resolve())); child.kill(); await closed; }
        expect(path.dirname(fs.realpathSync(root))).toBe(parent); expect(path.basename(root).startsWith('asset-filters-native-')).toBe(true);
        await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
});
