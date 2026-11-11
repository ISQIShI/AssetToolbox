import { test, expect, chromium, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
const require = createRequire(import.meta.url);
const project = fileURLToPath(new URL('../../', import.meta.url));
const { copyTool } = require(path.join(project, 'resource-core/tests/portable.js'));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function freePort(): Promise<number> { const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port; }
test('native portable app: config + dynamic providers + image resize + save-as + cancel/resume/retry + selective restore + relaunch', async ({}, info) => {
    // 安装会串行下载多个包（每包最多 60 秒），网络等待不能使用普通作业的 30 秒限时。
    test.setTimeout(600000);
    const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'asset-native-test-'));
    const tool = copyTool(root, true, true), source = path.join(root, '中文 素材'), backup = path.join(root, '原图备份'), output = path.join(root, '另存 结果');
    fs.mkdirSync(path.join(tool, 'runtime')); fs.copyFileSync(path.join(project, 'runtime/node.exe'), path.join(tool, 'runtime/node.exe'));
    fs.copyFileSync(path.join(project, 'AssetToolbox.exe'), path.join(tool, 'AssetToolbox.exe'));
    fs.copyFileSync(path.join(project, 'resource-core/desktop-bridge.js'), path.join(tool, 'resource-core/desktop-bridge.js'));
    const module = path.join(tool, 'resource-core/providers/extra'); fs.mkdirSync(module); require(path.join(project, 'resource-core/tests/helpers.js')).installType(tool, 'extra');
    fs.writeFileSync(path.join(module, 'config.js'), 'module.exports=' + JSON.stringify({ displayName: '扩展测试模块', order: 5, extensions: ['.pack'], enabledKey: 'extraEnabled', defaults: { extraLevel: 3, extraMode: 'fast', extraText: '原参数' }, limits: { extraLevel: { label: '测试级别', min: 1, max: 9 } }, parameters: { extraMode: { label: '测试模式', type: 'enum', choices: ['fast', 'best'] }, extraText: { label: '测试文字', type: 'text', maxLength: 32767 } } }));
    fs.writeFileSync(path.join(module, 'index.js'), `const fs=require('node:fs'),path=require('node:path');module.exports={apiVersion:2,version:'1.0.0',displayName:'测试提供方',adapters:{'compress':{version:'1.0.0',resourceTypes:['extra'],schema:require('./config'),execute({input,output}){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,500);const bytes=fs.readFileSync(input);fs.appendFileSync(path.join(__dirname,'calls.txt'),bytes.subarray(0,6)+'\\n');if(bytes.toString().startsWith('PACK:b')&&!fs.existsSync(path.join(__dirname,'repaired')))throw Error('模拟编码失败');fs.writeFileSync(output,bytes.subarray(0,10));return{output};}}}}`);
    // 只在隔离副本登记第二个操作及替代提供方，验证通用目录不依赖内置工具分支。
    const trimOperation = path.join(tool, 'resource-core/operations/fixture-trim'); fs.mkdirSync(trimOperation);
    fs.writeFileSync(path.join(trimOperation, 'index.js'), `module.exports={apiVersion:1,version:'1.0.0',displayName:'测试裁切',accepts:['image'],resultPolicy:'valid-output',schema:{defaults:{length:9},limits:{length:{label:'保留长度',min:5,max:20}}}};`);
    fs.appendFileSync(path.join(module, 'index.js'), `\n;module.exports.adapters['fixture-trim']={version:'1.0.0',resourceTypes:['extra'],schema:{defaults:{suffix:'!'},parameters:{suffix:{label:'追加字符'}}},execute({input,output,operation,parameters,providerOptions}){if(operation!=='fixture-trim')throw Error('操作分派错误');fs.writeFileSync(output,fs.readFileSync(input).subarray(0,parameters.length).toString()+providerOptions.suffix);return{output};}};`);
    const alternate = path.join(tool, 'resource-core/providers/alternate'); fs.mkdirSync(alternate);
    fs.writeFileSync(path.join(alternate, 'index.js'), `const fs=require('node:fs');module.exports={apiVersion:2,version:'1.0.0',displayName:'替代裁切工具',adapters:{'fixture-trim':{version:'1.0.0',resourceTypes:['extra'],schema:{defaults:{fast:true},parameters:{fast:{label:'快速模式'}}},execute({input,output,parameters}){fs.writeFileSync(output,fs.readFileSync(input).subarray(0,parameters.length));return{output};}}}};`);
    fs.mkdirSync(path.join(source, '二级'), { recursive: true });
    const originals = new Map<string, Buffer>();
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) { const data = Buffer.from('PACK:' + name + 'x'.repeat(4000)); const relative = path.join('二级', name + '.pack'); originals.set(relative, data); fs.writeFileSync(path.join(source, relative), data); }
    const settingsPath = path.join(tool, 'resource-core/data/settings.json');
    const config = { schema: 'asset-toolbox.settings/2', sourceDir: source, outputDir: output, backupDir: backup, saveMode: 'saveAs', backupEnabled: true, pipeline: [{ id: 'pack', resourceType: 'extra', operation: 'compress', provider: 'extra', enabled: true, parameters: {}, providerOptions: { extraLevel: 6, extraMode: 'best', extraText: '中文 配置' } }] };
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true }); fs.writeFileSync(settingsPath, JSON.stringify(config));
    // 缺少依赖的全新安装：只移动隔离副本，原项目工具保持不变。
    fs.renameSync(path.join(tool, 'resource-core/node_modules'), path.join(tool, 'resource-core/node_modules.manual'));
    for (const name of ['lame.exe', 'libmpg123-0.dll']) fs.renameSync(path.join(tool, 'resource-core/providers/lame', name), path.join(tool, 'resource-core/providers/lame', name + '.manual'));
    let child: ChildProcess | undefined, browser: Browser | undefined, page!: Page;
    const errors: string[] = [];
    async function launch() {
        const port = await freePort();
        child = spawn(path.join(tool, 'AssetToolbox.exe'), [], { cwd: root, windowsHide: true, stdio: 'ignore', env: { ...process.env, ASSET_TOOLBOX_TEST_PORT: String(port), WEBVIEW2_USER_DATA_FOLDER: path.join(root, 'webview') } });
        await expect.poll(async () => { try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); return response.ok; } catch { return false; } }, { timeout: 30000 }).toBe(true);
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        await expect.poll(() => browser!.contexts()[0]?.pages().length || 0).toBeGreaterThan(0);
        page = browser.contexts()[0].pages()[0]; page.on('pageerror', error => errors.push(error.message));
        await expect(page.getByRole('navigation', { name: '处理顺序' })).toBeVisible();
        await expect(page.getByLabel('来源文件夹', { exact: true })).toHaveValue(source);
    }
    const tab = (name: string) => page.getByRole('navigation', { name: '工作区' }).getByRole('button', { name, exact: false });
    const station = (name: 'source' | 'output' | 'scan') => page.locator(`[data-station="${name}"]`);
    const button = (name: string) => page.getByRole('button', { name, exact: true });
    let observedJob = '';
    async function started() {
        await expect.poll(async () => (await page.locator('.dock').getAttribute('data-job-id', { timeout: 200 }).catch(() => null)) || observedJob).not.toBe(observedJob);
        observedJob = (await page.locator('.dock').getAttribute('data-job-id'))!;
    }
    async function done(alreadyStarted = false, timeout = 30000) { if (!alreadyStarted) await started(); await expect(page.locator('.dock')).toHaveAttribute('data-state', 'done', { timeout }); }
    const processedCount = async () => Number((await page.locator('.dock .count').innerText()).split('/')[0].trim());
    async function close() {
        await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('plugin:window|close', { label: 'main' })).catch(cause => { if (!/closed|destroyed/i.test(String(cause))) throw cause; });
        await expect.poll(() => child!.exitCode, { timeout: 15000, message: 'Native close must release the host process: ' + errors.join('; ') }).not.toBeNull();
        await browser?.close(); browser = undefined; child = undefined;
    }
    try {
        await launch();
        // 直接从核验渠道安装，之后的真实缩放使用受管理的 Sharp。
        await tab('工具').click();
        await page.screenshot({ path: info.outputPath('dependency-missing.png'), fullPage: true });
        for (const id of ['lame', 'sharp']) {
            const provider = page.locator(`[data-provider-id="${id}"]`);
            await expect(provider).toContainText('缺少依赖');
            await provider.getByRole('button', { name: '获取并安装', exact: true }).click();
            await started();
            if (id === 'lame') await page.screenshot({ path: info.outputPath('dependency-progress.png'), fullPage: true });
            await done(true, id === 'sharp' ? 330000 : 75000);
            await expect(page.locator('.dock')).toContainText('已安装并通过完整性校验');
            await expect(provider).toContainText('已安装核验版本');
            await expect(provider.locator('.state')).toHaveText('可用');
            await page.getByRole('button', { name: '关闭作业结果' }).click();
        }
        await page.screenshot({ path: info.outputPath('installed-dependencies.png'), fullPage: true });
        // 模拟上一核验清单记录，走更新按钮；旧目录仍可供运行中的快照使用。
        const recordFile = path.join(tool, 'resource-core/data/dependencies/lame/active.json');
        const previous = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
        fs.writeFileSync(recordFile, JSON.stringify({ ...previous, catalogHash: 'previous-approved-catalog' }));
        await button('刷新依赖状态').click();
        const lame = page.locator('[data-provider-id="lame"]');
        if (!(await lame.locator('details').getAttribute('open') !== null)) await lame.locator('summary').click();
        await lame.getByRole('button', { name: '更新到核验版本', exact: true }).click(); await done(false, 75000);
        await expect(lame).toContainText('已安装核验版本');
        expect(JSON.parse(fs.readFileSync(recordFile, 'utf8')).directory).not.toBe(previous.directory);
        expect(fs.existsSync(path.join(tool, 'resource-core/data/dependencies/lame/installs', previous.directory))).toBe(true);
        await page.getByRole('button', { name: '关闭作业结果' }).click();
        // 工具页：移走真实编码器后显示缺失原因与获取渠道，放回后恢复可用。
        const pngTool = path.join(tool, 'resource-core/providers/pngquant/pngquant.exe');
        fs.renameSync(pngTool, pngTool + '.held');
        await tab('工具').click();
        await button('刷新依赖状态').click();
        const missing = page.locator('[data-provider-id="pngquant"]');
        await expect(missing).toContainText('缺少文件：pngquant.exe');
        await expect(missing.getByRole('link', { name: '打开获取页面' })).toHaveAttribute('href', 'https://pngquant.org/');
        await expect(missing).toContainText('cargo install pngquant');
        await expect(tab('工具')).toContainText('1');
        await page.screenshot({ path: info.outputPath('missing-provider.png'), fullPage: true });
        fs.renameSync(pngTool + '.held', pngTool);
        await button('刷新依赖状态').click();
        await expect(missing).toContainText('可用');
        await tab('处理').click();
        await page.locator('.rail [data-step-id="pack"] button').click();
        await expect(page.getByLabel('测试级别', { exact: false })).toHaveValue('6');
        await expect(page.getByLabel('测试文字', { exact: true })).toHaveValue('中文 配置');
        expect(fs.existsSync(path.join(tool, 'resource-core/config'))).toBe(false);
        await page.screenshot({ path: info.outputPath('workspace.png'), fullPage: true });
        await page.setViewportSize({ width: 840, height: 620 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath('compact.png'), fullPage: true });
        await page.setViewportSize({ width: 1220, height: 850 });
        // 扫描预览：结果归入处理线末端，作业栏收起；其他页面不显示。
        await button('扫描预览').click();
        await expect(page.getByRole('heading', { name: '扫描结果', exact: true })).toBeVisible();
        await expect(page.locator('.dock')).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('scan-result.png'), fullPage: true });
        for (const name of ['任务', '恢复']) {
            await tab(name).click();
            await expect(page.locator('.dock')).toHaveCount(0);
            await expect(page.getByRole('heading', { name: '扫描结果', exact: true })).toHaveCount(0);
            await page.screenshot({ path: info.outputPath(name === '任务' ? 'preview-tasks.png' : 'preview-restore.png'), fullPage: true });
        }
        await tab('处理').click();
        expect(fs.existsSync(path.join(tool, 'resource-core/config'))).toBe(false);
        expect(fs.existsSync(path.join(tool, 'resource-core/data/tasks'))).toBe(false);
        await button('开始处理').click(); await done();
        for (const [relative, original] of originals) expect(fs.readFileSync(path.join(source, relative))).toEqual(original);
        expect(fs.readFileSync(path.join(output, '二级/a.pack')).length).toBe(10);
        expect(fs.readFileSync(path.join(output, '二级/b.pack'))).toEqual(originals.get(path.join('二级/b.pack')));
        await button('关闭作业结果').click();
        await expect(page.locator('.dock')).toHaveCount(0);
        // 覆盖 + 备份，运行中从其他页面取消。
        await station('output').click();
        await page.getByLabel('覆盖原文件', { exact: false }).check();
        await page.getByLabel('替换前备份原文件', { exact: false }).check();
        await button('开始处理').click();
        await started();
        await expect.poll(processedCount).toBeGreaterThan(0);
        await tab('任务').click();
        await button('取消').click();
        await tab('处理').click(); await done(true);
        await button('查看任务').click();
        await expect(button('继续未完成')).toBeEnabled();
        await button('继续未完成').click(); await done();
        fs.writeFileSync(path.join(module, 'repaired'), '');
        await button('关闭作业结果').click();
        await button('重试失败项').click(); await done();
        const calls = fs.readFileSync(path.join(module, 'calls.txt'), 'utf8').trim().split('\n');
        expect(calls.filter(line => line === 'PACK:a')).toHaveLength(2);
        expect(calls.filter(line => line === 'PACK:b')).toHaveLength(3);
        // 选择性恢复：用户后来编辑过的文件为冲突，不可勾选。
        const conflict = path.join(source, '二级/a.pack'); fs.writeFileSync(conflict, '用户后来编辑的内容');
        await button('关闭作业结果').click();
        await button('检查备份').click();
        await expect(page.getByRole('region', { name: '恢复前检查结果' })).toBeVisible();
        await expect(page.locator('.dock')).toHaveCount(0);
        await expect(page.getByLabel(`恢复 二级\\a.pack`, { exact: true })).toBeDisabled();
        await button('取消勾选筛选结果').click();
        await page.getByLabel(`恢复 二级\\c.pack`, { exact: true }).check();
        await page.getByLabel('搜索恢复文件').fill('b.pack');
        await expect(page.locator('.restore-table .foot')).toContainText('1 项被筛选隐藏');
        await page.screenshot({ path: info.outputPath('restore.png'), fullPage: true });
        await button('恢复所选 1 项').click(); await done();
        expect(fs.readFileSync(path.join(source, '二级/c.pack'))).toEqual(originals.get(path.join('二级/c.pack')));
        expect(fs.readFileSync(path.join(source, '二级/b.pack')).length).toBe(10);
        expect(fs.readFileSync(conflict, 'utf8')).toBe('用户后来编辑的内容');
        // 在同一原生应用中新增非压缩步骤，实测另存结果尺寸和透明通道。
        await button('关闭作业结果').click();
        await tab('处理').click();
        const imageSource = path.join(root, '图片'), imageOutput = path.join(root, '缩放结果'); fs.mkdirSync(imageSource);
        const sharp = require(path.join(project, 'resource-core/node_modules/sharp'));
        await sharp({ create: { width: 80, height: 40, channels: 4, background: { r: 120, g: 40, b: 200, alpha: 0.5 } } }).png().toFile(path.join(imageSource, '透明.png'));
        await station('source').click();
        await page.getByLabel('来源文件夹', { exact: true }).fill(imageSource);
        await station('output').click();
        await page.getByLabel('另存到新文件夹', { exact: false }).check();
        await page.getByLabel('另存文件夹', { exact: true }).fill(imageOutput);
        // 真实目录按操作分组；两种窗口尺寸与主题下选择器不越界，键盘可完成添加。
        const addStep = page.locator('.adder > .station-button');
        const picker = page.getByRole('dialog', { name: '添加步骤', exact: true });
        async function pickerFits() {
            const box = await picker.boundingBox(), viewport = page.viewportSize()!;
            expect(box).not.toBeNull();
            expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
            expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
            expect(box!.height).toBeLessThanOrEqual(360);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        }
        for (const [width, height] of [[1220, 850], [840, 620]]) {
            await page.setViewportSize({ width, height });
            for (const theme of ['light', 'dark']) {
                await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
                await addStep.click();
                await expect(picker.locator('.choice')).toHaveCount(6);
                await pickerFits();
                await page.screenshot({ path: info.outputPath(`step-picker-${width}-${theme}.png`), fullPage: true });
                await picker.getByRole('button', { name: '图片缩放', exact: true }).click();
                await expect(picker.getByRole('button', { name: 'PNG', exact: true })).toBeVisible();
                await pickerFits();
                await page.screenshot({ path: info.outputPath(`step-formats-${width}-${theme}.png`), fullPage: true });
                await page.keyboard.press('Escape'); await expect(addStep).toBeFocused();
            }
        }
        await page.setViewportSize({ width: 1220, height: 850 });
        await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
        await addStep.click();
        await page.getByLabel('搜索操作或格式').fill('缩放');
        await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
        await page.getByLabel('搜索资源类型').fill('.png');
        await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
        await expect(picker).toHaveCount(0);
        await expect(page.locator('.editor h2')).toHaveText('PNG 图片缩放');
        await page.getByLabel('目标宽度', { exact: true }).fill('20');
        await page.getByLabel('目标高度', { exact: true }).fill('20');
        await button('上移').click();
        await expect(page.locator('.rail [data-step-id]').first()).toContainText('PNG 图片缩放');
        await page.screenshot({ path: info.outputPath('resize.png'), fullPage: true });
        await button('开始处理').click(); await done();
        const resized = await sharp(path.join(imageOutput, '透明.png')).metadata();
        expect([resized.width, resized.height, resized.hasAlpha]).toEqual([20, 10, true]);
        expect((await sharp(path.join(imageSource, '透明.png')).metadata()).width).toBe(80);
        await button('关闭作业结果').click();
        await page.locator('.rail [data-step-id] button').first().click();
        await button('删除步骤').click();
        const adapterSource = path.join(root, '适配器素材'), adapterOutput = path.join(root, '适配器结果'); fs.mkdirSync(adapterSource);
        fs.writeFileSync(path.join(adapterSource, 'a.pack'), 'PACK:axxxxxxxxxxxxxxxxx');
        await station('source').click(); await page.getByLabel('来源文件夹', { exact: true }).fill(adapterSource);
        await station('output').click(); await page.getByLabel('另存文件夹', { exact: true }).fill(adapterOutput);
        await addStep.click();
        await picker.getByRole('button', { name: '测试裁切', exact: true }).click();
        await picker.getByRole('button', { name: '测试资源', exact: true }).click();
        await page.getByLabel('处理工具', { exact: true }).selectOption('extra');
        await page.getByLabel('保留长度', { exact: true }).fill('8');
        await page.getByLabel('追加字符', { exact: true }).fill('?');
        await page.getByLabel('处理工具', { exact: true }).selectOption('alternate');
        await expect(page.getByLabel('保留长度', { exact: true })).toHaveValue('8');
        await expect(page.getByLabel('快速模式', { exact: true })).toBeChecked();
        await expect(page.getByLabel('追加字符', { exact: true })).toHaveCount(0);
        await page.getByLabel('处理工具', { exact: true }).selectOption('extra');
        await expect(page.getByLabel('保留长度', { exact: true })).toHaveValue('8');
        await expect(page.getByLabel('追加字符', { exact: true })).toHaveValue('!');
        await expect(page.getByLabel('测试级别', { exact: false })).toHaveCount(0);
        await page.screenshot({ path: info.outputPath('operation-adapter.png'), fullPage: true });
        await page.setViewportSize({ width: 840, height: 620 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath('operation-adapter-compact.png'), fullPage: true });
        await page.setViewportSize({ width: 1220, height: 850 });
        await button('开始处理').click(); await done();
        expect(fs.readFileSync(path.join(adapterOutput, 'a.pack'), 'utf8')).toBe('PACK:axx!');
        const [adapterTask] = require(path.join(tool, 'resource-core/tasks.js')).listTasks();
        const adapterHeader = JSON.parse(fs.readFileSync(adapterTask.taskFile, 'utf8'));
        expect(adapterHeader.pipeline.map((s: any) => [s.provider, s.operation, s.versions.adapter])).toEqual([['extra', 'compress', '1.0.0'], ['extra', 'fixture-trim', '1.0.0']]);
        // 原生 IPC 与真实 CLI 读取同一持久作业，格式和结果必须一致。
        const completedJobId = observedJob; expect(completedJobId).toMatch(/^[a-f0-9]{64}$/);
        const nativeStatus = await page.evaluate(jobId => (window as any).__TAURI_INTERNALS__.invoke('core_call', { action: 'status', payload: { jobId } }), completedJobId);
        const cliStatus = spawnSync(path.join(tool, 'runtime/node.exe'), [path.join(tool, 'resource-core/cli.js'), 'api', 'status', '--local', '--input', '-'], { input: JSON.stringify({ jobId: completedJobId }), encoding: 'utf8', windowsHide: true, timeout: 15000 });
        expect(cliStatus.status, cliStatus.stderr).toBe(0);
        expect(JSON.parse(cliStatus.stdout).schema).toBe('asset-toolbox.response/2');
        expect(JSON.parse(cliStatus.stdout).result).toEqual(nativeStatus);
        expect(nativeStatus.taskId).toBe(adapterTask.id); expect(nativeStatus.task).not.toHaveProperty('taskFile');
        expect(nativeStatus.hasReport).toBe(true); expect(nativeStatus).not.toHaveProperty('reportDirectory');
        await button('关闭作业结果').click(); await button('删除步骤').click();
        await station('source').click();
        await page.getByLabel('来源文件夹', { exact: true }).fill(source);
        await station('output').click();
        await page.getByLabel('覆盖原文件', { exact: false }).check();
        await button('保存配置').click();
        await close(); await launch();
        const reopenedStatus = await page.evaluate(jobId => (window as any).__TAURI_INTERNALS__.invoke('core_call', { action: 'status', payload: { jobId } }), completedJobId);
        expect(reopenedStatus).toEqual(nativeStatus);
        await station('output').click();
        await expect(page.getByLabel('覆盖原文件', { exact: false })).toBeChecked();
        await expect(page.getByLabel('替换前备份原文件', { exact: false })).toBeChecked();
        expect(fs.readFileSync(settingsPath, 'utf8')).toContain('中文 配置');
        expect(errors).toEqual([]);
        // 运行中关闭窗口：先协作取消，任务保留可继续状态。
        await button('开始处理').click();
        await started();
        await expect.poll(processedCount).toBeGreaterThan(0);
        await close();
        const [lastTask] = require(path.join(tool, 'resource-core/tasks.js')).listTasks();
        expect(lastTask.canResume).toBe(true); expect(lastTask.pending).toBeGreaterThan(0);
    } catch (cause) {
        console.error('Native flow failed:', cause);
        await page?.screenshot({ path: info.outputPath('failure.png'), fullPage: true }).catch(() => {});
        throw cause;
    } finally {
        if (browser) await browser.close().catch(() => {});
        if (child && child.exitCode === null) { const exited = new Promise<void>(resolve => child!.once('exit', () => resolve())); child.kill(); await exited; }
        await sleep(1800);
        expect(path.dirname(fs.realpathSync(root))).toBe(parent); expect(path.basename(root).startsWith('asset-native-test-')).toBe(true);
        await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(cause => console.error('Temporary cleanup failed:', root, cause));
    }
});
