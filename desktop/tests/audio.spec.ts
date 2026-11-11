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
const browserOnly = process.env.ASSET_TOOLBOX_AUDIO_BROWSER === '1';

test(`${browserOnly ? 'browser with real core' : 'native'} audio analysis, peak-limited gain, rejection and linear loudness normalization`, async ({}, info) => {
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-audio-native-'));
    const tool = require(path.join(project, 'resource-core/tests/portable')).copyTool(root, false, true);
    const source = path.join(root, '声音'), output = path.join(root, '输出'); fs.mkdirSync(source);
    fs.mkdirSync(path.join(tool, 'runtime')); fs.copyFileSync(path.join(project, 'runtime/node.exe'), path.join(tool, 'runtime/node.exe'));
    if (!browserOnly) fs.copyFileSync(path.join(project, 'AssetToolbox.exe'), path.join(tool, 'AssetToolbox.exe'));
    const ffmpeg = path.join(tool, 'resource-core/providers/ffmpeg/ffmpeg.exe');
    require(path.join(project, 'resource-core/providers/ffmpeg/audio')).run(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', path.join(source, 'tone.wav')]);
    const original = fs.readFileSync(path.join(source, 'tone.wav'));
    const settings = { schema: 'asset-toolbox.settings/2', sourceDir: source, outputDir: '', backupDir: '', saveMode: 'saveAs', backupEnabled: false,
        pipeline: [{ id: 'audio', resourceType: 'wav', operation: 'audio-analyze', provider: 'ffmpeg', enabled: true, parameters: {}, providerOptions: {} }] };
    fs.mkdirSync(path.join(tool, 'resource-core/data')); fs.writeFileSync(path.join(tool, 'resource-core/data/settings.json'), JSON.stringify(settings));
    let child: ChildProcess | undefined, browser: Browser | undefined, page: Page | undefined;
    let web: Awaited<ReturnType<typeof import('vite').preview>> | undefined;
    let bridge: { dispatch: (action: string, payload: unknown) => Promise<unknown>; shutdown: () => Promise<void> } | undefined;
    const errors: string[] = [];
    try {
        if (browserOnly) {
            // 独立替代验收：真实核心与 FFmpeg，只模拟原生窗口 IPC；不冒充 EXE 验证。
            bridge = new (require(path.join(tool, 'resource-core/desktop-bridge')).DesktopBridge)();
            web = await (await import('vite')).preview({ root: path.join(project, 'desktop'), configFile: false, preview: { host: '127.0.0.1', port: 0 } });
            browser = await chromium.launch({ channel: 'msedge' }); page = await browser.newPage({ viewport: { width: 1220, height: 850 } });
            await page.exposeFunction('audioTestInvoke', (command: string, args: { action: string; payload: unknown }) => {
                if (command === 'core_call') return bridge!.dispatch(args.action, args.payload);
                if (command.startsWith('plugin:event|') || command.startsWith('plugin:window|')) return Promise.resolve(0);
                throw new Error('未模拟的原生命令：' + command);
            });
            await page.addInitScript(() => { (window as any).__TAURI_INTERNALS__ = { metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } }, transformCallback: () => 1, invoke: (window as any).audioTestInvoke }; });
            await page.goto(web.resolvedUrls!.local[0]!);
        } else {
        const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port;
        await new Promise<void>(resolve => server.close(() => resolve()));
        child = spawn(path.join(tool, 'AssetToolbox.exe'), [], { cwd: tool, windowsHide: true, stdio: 'ignore', env: { ...process.env, ASSET_TOOLBOX_TEST_PORT: String(port), WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'webview') } });
        await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); page = browser.contexts()[0]!.pages()[0]!;
        }
        page.on('pageerror', error => errors.push(error.message));
        const button = (name: string) => page!.getByRole('button', { name, exact: true });
        async function run() {
            await button('开始处理').click(); await expect(page!.locator('.dock')).toHaveAttribute('data-state', 'done', { timeout: 30000 });
            await expect(page!.locator('.audio-results')).toBeVisible();
            expect(fs.readFileSync(path.join(source, 'tone.wav'))).toEqual(original);
        }
        await expect(page.getByText('仅分析，不写入素材', { exact: true })).toBeVisible();
        await run(); await expect(page.locator('.audio-results')).toContainText('仅分析');
        expect(fs.existsSync(output)).toBe(false);
        await page.screenshot({ path: info.outputPath('audio-analysis.png'), fullPage: true });
        await button('关闭作业结果').click();
        await page.locator('[data-step-id="audio"] button').click();
        await page.getByLabel('操作', { exact: true }).selectOption('audio-gain');
        await page.getByLabel('增益（dB）', { exact: true }).fill('30');
        await page.locator('[data-station="output"]').click(); await expect(page.getByLabel('另存到新文件夹', { exact: false })).toBeChecked();
        await page.getByLabel('另存文件夹', { exact: true }).fill(output);
        await run(); await expect(page.locator('.audio-results')).toContainText('已限制整段增益');
        await expect(page.locator('.audio-results')).toContainText('未使用动态压缩');
        const measure = require(path.join(project, 'resource-core/providers/ffmpeg/audio')).inspect;
        expect(measure(ffmpeg, path.join(output, 'tone.wav'), 'wav').truePeakDb).toBeLessThanOrEqual(-1);
        for (const width of [1220, 840]) {
            await page.setViewportSize({ width, height: width === 840 ? 620 : 850 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({ path: info.outputPath(`audio-gain-${width}.png`), fullPage: true });
        }
        await page.locator('.tab.theme').click(); await page.screenshot({ path: info.outputPath('audio-gain-dark.png'), fullPage: true });
        await button('关闭作业结果').click();
        await page.locator('[data-step-id="audio"] button').click(); await page.getByLabel('超峰处理', { exact: true }).selectOption('reject');
        await page.locator('[data-station="output"]').click(); await page.getByLabel('另存文件夹', { exact: true }).fill(output + '-reject');
        await run(); await expect(page.locator('.audio-results')).toContainText('未提交');
        await expect(page.locator('.audio-results')).toContainText('预计真峰值');
        await button('关闭作业结果').click();
        await page.locator('[data-step-id="audio"] button').click(); await page.getByLabel('操作', { exact: true }).selectOption('audio-normalize');
        await page.getByLabel('目标响度（LUFS）', { exact: true }).fill('-18');
        await page.locator('[data-station="output"]').click(); await page.getByLabel('另存文件夹', { exact: true }).fill(output + '-normalized');
        await run(); await expect(page.locator('.audio-results')).toContainText('已达到');
        expect(Math.abs(measure(ffmpeg, path.join(output + '-normalized', 'tone.wav'), 'wav').integratedLufs + 18)).toBeLessThanOrEqual(0.3);
        const reports = path.join(tool, 'resource-core/data/reports');
        expect(fs.readdirSync(reports).every(name => fs.existsSync(path.join(reports, name, 'audio.csv')))).toBe(true);
        // 缺失 FFprobe 时，前端仍提供安装渠道和手动说明。
        fs.renameSync(path.join(path.dirname(ffmpeg), 'ffprobe.exe'), path.join(path.dirname(ffmpeg), 'ffprobe.held'));
        await page.getByRole('navigation', { name: '工作区' }).getByRole('button', { name: '工具', exact: false }).click();
        await button('刷新依赖状态').click();
        const provider = page.locator('[data-provider-id="ffmpeg"]');
        await expect(provider).toContainText('ffprobe.exe'); await expect(provider).toContainText('手动安装');
        await expect(provider.getByRole('link', { name: '打开获取页面' })).toHaveAttribute('href', 'https://www.gyan.dev/ffmpeg/builds/');
        expect(errors).toEqual([]);
        if (!browserOnly) {
            await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' }));
            await expect.poll(() => child!.exitCode).not.toBeNull();
        }
    } catch (error) {
        await page?.screenshot({ path: info.outputPath('failure.png'), fullPage: true }).catch(() => {}); throw error;
    } finally {
        await browser?.close().catch(() => {});
        await bridge?.shutdown();
        if (web) await new Promise<void>((resolve, reject) => web!.httpServer.close(error => error ? reject(error) : resolve()));
        if (child && child.exitCode === null) { const exited = new Promise<void>(resolve => child!.once('exit', () => resolve())); child.kill(); await exited; }
        expect(path.dirname(fs.realpathSync(root))).toBe(parent); expect(path.basename(root).startsWith('asset-audio-native-')).toBe(true);
        await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    }
});
