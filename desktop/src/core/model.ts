// 纯函数：请求构造、步骤生成、格式化与恢复勾选。界面组件只调用这里，不自行拼协议结构。
import type { Configuration, Definition, JobRequest, Provider, RestoreFile, RestoreScope, Selection, Step, Support, Task } from './types';

export function bytes(value?: number | null): string {
    if (value == null) return '—';
    const sign = value < 0 ? '−' : '';
    let size = Math.abs(value), index = 0;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index++; }
    return `${sign}${index ? size.toFixed(1) : size} ${units[index]}`;
}

/** 体积变化：节省为负号前缀的减少量，增大显示为加号。核心 savedBytes 为正表示节省。 */
export function sizeChange(saved?: number | null): string {
    if (saved == null) return '—';
    if (saved === 0) return '0 B';
    return saved > 0 ? `−${bytes(saved)}` : `+${bytes(-saved)}`;
}

export function folderName(value: string): string {
    const trimmed = value.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/, '');
    return trimmed.split(/[\\/]/).pop() || trimmed;
}

export function elapsed(seconds = 0): string {
    const whole = Math.floor(seconds);
    return whole < 60 ? `${whole} 秒` : `${Math.floor(whole / 60)} 分 ${whole % 60} 秒`;
}

export function date(value?: string): string {
    return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

/** 目录中全部“资源类型 + 操作”组合，按资源类型、操作顺序去重，供添加步骤菜单使用。 */
export function stepChoices(definition: Definition): (Support & { label: string })[] {
    const seen = new Set<string>(), result: (Support & { label: string })[] = [];
    for (const type of definition.resourceTypes) for (const operation of definition.operations) {
        const key = `${type.id}/${operation.id}`;
        if (seen.has(key) || !definition.providers.some(provider => provider.supports.some(s => s.resourceType === type.id && s.operation === operation.id))) continue;
        seen.add(key); result.push({ resourceType: type.id, operation: operation.id, label: `${type.displayName} ${operation.displayName}` });
    }
    return result;
}

export function stepTitle(definition: Definition, step: Step): string {
    const type = definition.resourceTypes.find(item => item.id === step.resourceType)?.displayName || step.resourceType;
    const operation = definition.operations.find(item => item.id === step.operation)?.displayName || step.operation;
    return `${type} ${operation}`;
}

export function providerOf(definition: Definition, step: Step): Provider | undefined {
    return definition.providers.find(item => item.id === step.provider);
}

export function isMissing(provider?: Provider): boolean {
    return provider?.availability?.available === false;
}

export function createStep(definition: Definition, resourceType: string, operation: string, provider?: string, id = crypto.randomUUID()): Step {
    const implementation = definition.providers.find(item => (!provider || item.id === provider) && item.supports.some(s => s.resourceType === resourceType && s.operation === operation));
    const action = definition.operations.find(item => item.id === operation);
    if (!implementation || !action) throw new Error('没有能执行此操作的处理工具');
    return {
        id: 'step-' + id, resourceType, operation, provider: implementation.id, enabled: true,
        parameters: Object.fromEntries(action.fields.map(field => [field.key, field.default])),
        providerOptions: Object.fromEntries(implementation.fields.map(field => [field.key, field.default])),
    };
}

/** 切换资源类型、操作或工具：重建参数，保留步骤 ID 与启用状态。找不到组合时返回 undefined。 */
export function retargetStep(definition: Definition, step: Step, resourceType: string, operation?: string, provider?: string): Step | undefined {
    const implementation = definition.providers.find(item => (!provider || item.id === provider) && item.supports.some(s => s.resourceType === resourceType && (!operation || s.operation === operation)));
    const support = implementation?.supports.find(s => s.resourceType === resourceType && (!operation || s.operation === operation));
    if (!implementation || !support) return undefined;
    return { ...createStep(definition, resourceType, support.operation, implementation.id), id: step.id, enabled: step.enabled };
}

export function resetStep(definition: Definition, step: Step): Step {
    return { ...createStep(definition, step.resourceType, step.operation, step.provider), id: step.id, enabled: step.enabled };
}

export function initialSelection(files: RestoreFile[], scope: RestoreScope): Set<string> {
    return new Set(files.filter(file => file.selectable && (scope === 'all' || (file.inLastSelection && file.queue === (scope === 'retry' ? 'failed' : 'pending')))).map(file => file.path));
}

export function selectionPayload(files: RestoreFile[], selected: Set<string>): Selection[] {
    return files.filter(file => file.selectable && selected.has(file.path)).map(({ path, backupHash, targetHash }) => ({ path, backupHash, targetHash }));
}

export function visibleFiles(files: RestoreFile[], state: string, query: string): RestoreFile[] {
    const text = query.trim().toLocaleLowerCase();
    return files.filter(file => (state === 'all' || file.state === state) && (!text || `${file.path}\n${file.reason}`.toLocaleLowerCase().includes(text)));
}

const clean = (value: string) => value.trim().replace(/^"|"$/g, '');

export function processingRequest(config: Configuration, mode: 'preview' | 'process'): JobRequest {
    if (!config.sourceDir.trim()) throw new Error('请选择来源文件夹');
    if (config.saveMode === 'saveAs' && !config.outputDir.trim()) throw new Error('请选择另存文件夹');
    if (config.saveMode === 'overwrite' && config.backupEnabled && !config.backupDir.trim()) throw new Error('请选择备份文件夹');
    return {
        mode, folder: clean(config.sourceDir), pipeline: config.pipeline,
        ...(config.saveMode === 'saveAs' ? { outputDir: clean(config.outputDir) } : config.backupEnabled ? { backupDir: clean(config.backupDir) } : {}),
    };
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger';

export function taskStatus(task: Task): { label: string; tone: Tone } {
    if (task.error) return { label: '无法读取', tone: 'danger' };
    if (task.restoreStarted) return { label: '已开始恢复', tone: 'neutral' };
    if (task.canResume) return { label: '可继续', tone: 'warn' };
    if (task.failed) return { label: '有失败项', tone: 'danger' };
    return { label: '已完成', tone: 'ok' };
}
