// 仅用于 `npm run dev:web` 的界面调试：在浏览器中模拟 resource-core 的桌面桥接。
// 不读写任何文件，数据全部为生成样例。不得在测试或生产代码中引用。
import type { Bootstrap, Configuration, Definition, JobRequest, JobState, Provider, RestorePreview, ScanPreview, Task } from './types';

import { audioTypes, audioOperations, audioProvider } from './preview-audio';
import { previewProperties } from './preview-properties';

const params = new URLSearchParams(location.search);
const acquisition = (name: string, version: string, license: string, url: string, instructions: string) => ({ name, version, license, url, source: url, instructions, redistribution: '仅本地使用，发布前须完成许可核对。', checkedAt: '2026-11-08' });
const providers: Provider[] = [
    { id: 'pngquant', displayName: 'pngquant 3.0.3', description: '', version: '3.0.0', supports: [{ resourceType: 'png', operation: 'compress' }],
        adapters: [{ operation: 'compress', version: '1.0.0', fields: [{ key: 'speed', type: 'integer', default: 3, label: 'PNG 速度', hint: '数值越高速度越快。', min: 1, max: 11, step: 1 }, { key: 'qualityMin', type: 'integer', default: 50, label: 'PNG 最低质量', hint: '最低质量不得高于最高质量；未达到时保留原图。', min: 0, max: 100, step: 1 }, { key: 'qualityMax', type: 'integer', default: 80, label: 'PNG 最高质量', hint: '数值越高质量和体积通常越高。', min: 0, max: 100, step: 1 }] }],
        availability: params.has('missing') ? { available: false, reason: '缺少文件：pngquant.exe' } : { available: true, reason: '' },
        acquisition: acquisition('pngquant', '3.0.3', 'GPL-3.0-or-later', 'https://pngquant.org/', '推荐运行 cargo install pngquant --version 3.0.3 --locked，再将 pngquant.exe 放入 resource-core/providers/pngquant/。') },
    { id: 'jpg-c', displayName: 'jpg-c', description: '', version: '2.0.0', supports: [{ resourceType: 'jpg', operation: 'compress' }],
        adapters: [{ operation: 'compress', version: '1.0.0', fields: [{ key: 'quality', type: 'integer', default: 5, label: 'JPG 质量', hint: '0 不压缩；数值越高质量和体积越高。', min: 0, max: 9, step: 1 }] }],
        availability: { available: true, reason: '' }, acquisition: acquisition('JPG-C', '4.0.21.902', '未找到明确再分发授权', 'https://zzy.my/blog/post/Jpg-C', '向作者页面获取，将 EXE 放入 resource-core/providers/jpg-c/。') },
    { id: 'lame', displayName: 'LAME 4.0', description: '', version: '3.0.0', supports: [{ resourceType: 'mp3', operation: 'compress' }],
        adapters: [{ operation: 'compress', version: '1.0.0', fields: [{ key: 'bitrate', type: 'integer', default: 24, label: 'MP3 平均码率', min: 8, max: 320, step: 1 }] }],
        availability: { available: true, reason: '' }, acquisition: acquisition('LAME', '4.0', 'LGPL-2.0-or-later', 'https://www.rarewares.org/mp3-lame-bundle.php', '将 lame.exe 和 libmpg123-0.dll 一起放入 resource-core/providers/lame/。') },
    { id: 'sharp', displayName: 'Sharp / libvips', description: '', version: '2.0.0', supports: [{ resourceType: 'png', operation: 'image-resize' }, { resourceType: 'jpg', operation: 'image-resize' }],
        adapters: [{ operation: 'image-resize', version: '1.0.0', fields: [{ key: 'jpegQuality', type: 'integer', default: 90, label: 'JPEG 输出质量', hint: '仅影响 JPEG；PNG 保留透明通道。', min: 1, max: 100, step: 1 }] }],
        availability: { available: true, reason: '' }, acquisition: acquisition('Sharp / libvips', 'sharp 0.35.5', 'Apache-2.0 AND LGPL-3.0-or-later', 'https://sharp.pixelplumbing.com/install/', '在 resource-core 目录执行 npm ci。') },
];
for (const provider of providers) {
    const automatic = provider.id === 'lame' || provider.id === 'sharp';
    provider.dependency = automatic ? {
        automatic: true, targetVersion: provider.id === 'lame' ? '4.0' : '0.35.5',
        installedVersion: params.has('updates') ? (provider.id === 'lame' ? '3.100' : '0.34.5') : undefined,
        state: params.has('updates') ? 'update' : params.has('missing-auto') ? 'missing' : 'unmanaged',
        action: params.has('updates') ? 'update' : 'install', sources: [provider.id === 'lame' ? 'www.rarewares.org' : 'registry.npmjs.org'],
        reason: '仅界面模拟，不下载或写入文件。实际安装使用项目核验清单。',
    } : { automatic: false, reason: '暂无符合当前核验条件的自动下载方案，请按下方渠道手动安装。' };
    if (automatic && params.has('missing-auto')) provider.availability = { available: false, reason: '尚未安装所需文件' };
}
const definition: Definition = {
    apiVersion: 4, properties: previewProperties, filterSchema: 'asset-toolbox.filter/1',
    resourceTypes: [
        { id: 'jpg', displayName: 'JPEG', kind: 'image', extensions: ['.jpg', '.jpeg'], version: '1.0.0' },
        { id: 'mp3', displayName: 'MP3', kind: 'audio', extensions: ['.mp3'], version: '1.0.0' },
        { id: 'png', displayName: 'PNG', kind: 'image', extensions: ['.png'], version: '1.0.0' },
    ],
    operations: [
        { id: 'compress', displayName: '压缩', description: '仅在结果体积变小时采用新内容。', accepts: ['image', 'audio'], resultPolicy: 'smaller-only', fields: [], version: '1.0.0' },
        { id: 'image-resize', displayName: '图片缩放', description: '保持格式；结果体积可以增大。按视觉方向处理，移除 EXIF 等附加元数据。', accepts: ['image'], resultPolicy: 'valid-output', version: '1.0.0', fields: [
            { key: 'width', type: 'integer', default: 512, label: '目标宽度', min: 1, max: 16384, step: 1 },
            { key: 'height', type: 'integer', default: 512, label: '目标高度', min: 1, max: 16384, step: 1 },
            { key: 'fit', type: 'enum', default: 'inside', label: '适应方式', choices: [{ label: '等比适应', value: 'inside' }, { label: '裁剪填充', value: 'cover' }, { label: '拉伸', value: 'fill' }] },
            { key: 'kernel', type: 'enum', default: 'lanczos3', label: '插值算法', choices: [{ label: '高质量 Lanczos3', value: 'lanczos3' }, { label: '最近邻（像素画）', value: 'nearest' }] },
            { key: 'withoutEnlargement', type: 'boolean', default: true, label: '仅缩小', hint: '关闭后允许放大；结果可能比源文件更大。' },
        ] },
    ],
    providers,
};
// 与核心契约一致的音频目录样例，仅供浏览器调试。
definition.resourceTypes.push(...audioTypes);
definition.operations.push(...audioOperations);
providers.push(audioProvider);
let config: Configuration = {
    schema: 'asset-toolbox.settings/3', sourceDir: 'D:\\Projects\\StarHarbor\\Assets\\UI', outputDir: '', backupDir: 'D:\\Projects\\StarHarbor\\Backups', saveMode: 'overwrite', backupEnabled: true,
    pipeline: [
        { id: 'resize-ui', resourceType: 'png', operation: 'image-resize', provider: 'sharp', enabled: true, parameters: { width: 1024, height: 1024, fit: 'inside', kernel: 'lanczos3', withoutEnlargement: true }, providerOptions: { jpegQuality: 90 } },
        { id: 'png', resourceType: 'png', operation: 'compress', provider: 'pngquant', enabled: true, parameters: {}, providerOptions: { speed: 3, qualityMin: 50, qualityMax: 80 } },
        { id: 'jpg', resourceType: 'jpg', operation: 'compress', provider: 'jpg-c', enabled: false, parameters: {}, providerOptions: { quality: 5 } },
        { id: 'mp3', resourceType: 'mp3', operation: 'compress', provider: 'lame', enabled: true, parameters: {}, providerOptions: { bitrate: 64 } },
    ],
};
const task = (id: string, source: string, completed: number, pending: number, failed: number, extra: Partial<Task> = {}): Task => ({
    id, createdAt: '2026-11-07T14:32:00Z', source, total: completed + pending + failed, completed, pending, failed,
    backupCount: completed, restored: 0, restoreFailed: 0, restoreStarted: false, canResume: pending > 0, canRetry: failed > 0, canRestore: completed > 0, canContinueRestore: false, canRetryRestore: false,
    backupSession: completed ? 'D:\\Projects\\StarHarbor\\Backups\\20261107-143200' : undefined,
    // 模拟体积：每个文件约 560 KB，已完成的平均压掉三成。
    totalBytes: (completed + pending + failed) * 573_440, originalBytes: completed * 573_440, outputBytes: Math.round(completed * 573_440 * 0.69), savedBytes: Math.round(completed * 573_440 * 0.31), ...extra,
});
const tasks: Task[] = params.has('empty') ? [] : [
    task('20261108-091500-ui', 'D:\\Projects\\StarHarbor\\Assets\\UI', 412, 0, 0),
    task('20261107-143200-audio', 'D:\\Projects\\StarHarbor\\Assets\\Audio\\Ambience', 86, 41, 3),
    task('20261102-180000-tiles', 'D:\\Projects\\StarHarbor\\Assets\\Tiles', 0, 0, 0, { outputDir: 'D:\\Exports\\Tiles', backupSession: undefined, backupCount: 0, total: 1280, completed: 1280, totalBytes: 1280 * 98_304, originalBytes: 1280 * 98_304, outputBytes: 1280 * 61_440, savedBytes: 1280 * 36_864 }),
];
const scan: ScanPreview = { total: 538, checked: 538, totalBytes: 312_400_000, enabledFiles: 497, conflicts: 0, issues: [], cancelled: false,
    resources: [{ id: 'png', name: 'PNG', enabled: true, count: 412, bytes: 201_000_000 }, { id: 'jpg', name: 'JPEG', enabled: false, count: 41, bytes: 38_000_000 }, { id: 'mp3', name: 'MP3', enabled: true, count: 85, bytes: 73_400_000 }] };
const restore: RestorePreview = { source: 'D:\\Projects\\StarHarbor\\Backups\\20261107-143200', destination: 'D:\\Projects\\StarHarbor\\Assets\\Audio\\Ambience', total: 6, checked: 6, recoverable: 4, restored: 1, conflict: 1, cancelled: false,
    files: ['harbor_wind.mp3', 'gulls_far.mp3', 'rain_tin_roof.mp3', 'engine_idle.mp3', 'bell_buoy.mp3', 'crowd_market.mp3'].map((name, index) => ({
        path: `loops\\${name}`, state: index === 4 ? 'restored' : index === 5 ? 'conflict' : 'recoverable', selectable: index < 4, queue: 'completed', inLastSelection: false,
        backupBytes: 820_000 + index * 37_000, currentBytes: 210_000 + index * 9_000, backupHash: 'a'.repeat(64), targetHash: 'b'.repeat(64),
        reason: index === 5 ? '目标文件在处理后被修改，与处理结果不一致' : index === 4 ? '目标内容已与备份一致' : '目标仍是本工具写入的处理结果' })) };

const jobs = new Map<string, { request: JobRequest; started: number; cancelled: boolean }>();
const DURATION = Number(params.get('duration') || 4000);
let maxConcurrent = 2;
let serviceConfig: any = null, serviceRunning = false;
function serviceSnapshot() { return { configured: !!serviceConfig, config: serviceConfig, state: serviceRunning ? 'running' : 'stopped', owned: serviceRunning, tokenFile: serviceConfig ? '浏览器预览：未生成令牌' : null, endpoints: serviceRunning ? { apiUrl: 'http://127.0.0.1:8787/api/v8/', mcpUrl: serviceConfig.mcp ? 'http://127.0.0.1:8787/mcp' : null } : null }; }

function poll(id: string): JobState {
    const job = jobs.get(id);
    if (!job) throw new Error('作业已失效');
    const total = job.request.mode.startsWith('restore') ? 6 : 538;
    const progress = Math.min(1, (Date.now() - job.started) / DURATION);
    const processed = Math.round(total * progress);
    const done = progress >= 1 || job.cancelled;
    if (job.request.mode === 'dependency-install') {
        const provider = providers.find(item => item.id === job.request.providerId)!;
        if (done && !job.cancelled) {
            provider.availability = { available: true, reason: '' };
            provider.dependency = { ...provider.dependency!, state: 'current', action: 'reinstall', installedVersion: provider.dependency!.targetVersion };
        }
        return { done, phase: done ? 'finished' : progress > 0.7 ? 'verifying' : 'downloading', processed: done ? 1 : 0, total: 1, cancelled: job.cancelled, exitCode: job.cancelled ? 2 : 0, current: provider.dependency!.sources?.[0], message: job.cancelled ? '模拟安装已取消。' : done ? '模拟安装完成，未写入文件。' : '模拟下载与校验，不访问外部网络。' };
    }
    const state: JobState = { done, phase: done ? 'finished' : job.request.mode.startsWith('restore') ? 'restoring' : 'processing', processed, total: progress < 0.1 ? 0 : total, elapsedSeconds: (Date.now() - job.started) / 1000, current: `audio\\loops\\harbor_wind_${processed}.mp3` };
    if (!done) return state;
    if (job.cancelled) { state.cancelled = true; state.exitCode = 2; }
    switch (job.request.mode) {
        case 'preview': state.preview = { ...scan, cancelled: Boolean(job.cancelled), checked: processed }; break;
        case 'restore-preview': case 'restore-export-preview': state.preview = restore; break;
        case 'restore': case 'restore-export': state.summary = { total: 4, restored: 4, restoredBytes: 3_500_000, skipped: 0, failed: 0 }; state.task = tasks[1]; break;
        default: state.summary = { total, processed: processed - 12, skipped: 9, failed: 3, savedBytes: 96_300_000, copied: 0, backedUp: processed - 12 }; state.task = tasks[1]; state.hasReport = true;
    }
    return state;
}

export async function call(action: string, payload: any): Promise<unknown> {
    await new Promise(resolve => setTimeout(resolve, 60));
    switch (action) {
        case 'service-status': return serviceSnapshot();
        case 'service-configure': if (serviceRunning) throw Error('先停止服务'); serviceConfig = structuredClone(payload); return serviceSnapshot();
        case 'service-start': if (!serviceConfig) throw Error('请先配置服务'); serviceRunning = true; return serviceSnapshot();
        case 'service-stop': serviceRunning = false; return { requested: true };
        case 'service-client-config': return { transport: payload.transport, note: '浏览器预览仅模拟界面，不监听端口或生成真实配置。' };
        case 'storage-preview': return { items: [], total: 0, nextOffset: null, retentionDays: payload.retentionDays ?? 30, scannedAt: new Date().toISOString(), eligibleCount: 0, eligibleBytes: 0, protectedCount: 0 };
        case 'storage-clean': throw new Error('浏览器预览不清理真实数据。');
        case 'bootstrap': return { config: structuredClone(config), definition: structuredClone(definition), warnings: [], root: 'D:\\Tools\\AssetToolbox\\resource-core', nodeVersion: '24.19.0' } satisfies Bootstrap;
        case 'providers': return structuredClone(providers);
        case 'tasks': return page(tasks, payload);
        case 'jobs': return page([...jobs].map(([jobId, job]) => ({ jobId, mode: job.request.mode, createdAt: new Date(job.started).toISOString() })).reverse(), payload);
        case 'queue': {
            const running = [...jobs].filter(([id]) => !poll(id).done).map(([jobId, job]) => ({ jobId, mode: job.request.mode, createdAt: new Date(job.started).toISOString(), state: poll(jobId) }));
            return { maxConcurrent, maxPending: 100, minConcurrent: 1, maxAllowedConcurrent: 8, availableProcessors: 8, recommendedConcurrent: 2, canConfigure: !running.length, runningCount: running.length, waitingCount: 0,
                slots: Array.from({ length: maxConcurrent }, (_, index) => ({ slot: index + 1, occupied: !!running[index], job: running[index] || null })), waiting: [] };
        }
        case 'scheduling-set': {
            if ([...jobs.keys()].some(id => !poll(id).done)) throw new Error('队列空闲后才能修改并行数量');
            if (!Number.isInteger(payload.maxConcurrent) || payload.maxConcurrent < 1 || payload.maxConcurrent > 8) throw new Error('并行数量必须为 1–8 的整数');
            maxConcurrent = payload.maxConcurrent; return { schema: 'asset-toolbox.scheduling/1', maxConcurrent };
        }
        case 'normalize': return JSON.parse(JSON.stringify(payload));
        case 'save': config = JSON.parse(JSON.stringify(payload)); return structuredClone(config);
        case 'submit': { const jobId = crypto.randomUUID(); jobs.set(jobId, { request: payload.request, started: Date.now(), cancelled: false }); return { jobId, replayed: false }; }
        case 'status': { const state = poll(payload.jobId); if (state.preview && 'files' in state.preview) state.preview = { ...state.preview, files: [] }; return { ...state, jobId: payload.jobId }; }
        case 'results': return page(payload.kind === 'restore' ? restore.files : [], payload);
        case 'cancel': { const job = jobs.get(payload.jobId); if (job) job.cancelled = true; return { requested: true }; }
        default: throw new Error('未知桌面操作：' + action);
    }
}

export async function chooseFolder(title: string): Promise<string> { return `D:\\Projects\\StarHarbor\\${title.replace(/^选择/, '')}`; }

function page<T>(items: T[], { offset = 0, limit = 50 }: { offset?: number; limit?: number }) { return { items: structuredClone(items.slice(offset, offset + limit)), total: items.length, nextOffset: offset + limit < items.length ? offset + limit : null }; }
