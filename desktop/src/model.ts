import type { Configuration, Definition, RestoreFile, RestoreScope, Selection, Step, Value, JobRequest } from './types';
export function bytes(value?: number | null): string {
    if (value == null) return '—';
    const sign = value < 0 ? '−' : ''; value = Math.abs(value);
    const units = ['B', 'KB', 'MB', 'GB', 'TB']; let index = 0;
    while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
    return `${sign}${index ? value.toFixed(1) : value} ${units[index]}`;
}
export function createStep(definition: Definition, resourceType: string, operation: string, provider?: string, id = crypto.randomUUID()): Step {
    const implementation = definition.providers.find(item => (!provider || item.id === provider) && item.supports.some(s => s.resourceType === resourceType && s.operation === operation));
    const action = definition.operations.find(item => item.id === operation);
    if (!implementation || !action) throw new Error('没有匹配的实现提供方');
    return { id: 'step-' + id, resourceType, operation, provider: implementation.id, enabled: true,
        parameters: Object.fromEntries(action.fields.map(field => [field.key, field.default])),
        providerOptions: Object.fromEntries(implementation.fields.map(field => [field.key, field.default])) };
}
export function resetParameters(config: Configuration, definition: Definition): Configuration {
    return { ...config, pipeline: config.pipeline.map(step => ({ ...createStep(definition, step.resourceType, step.operation, step.provider), id: step.id, enabled: step.enabled })) };
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
export function processingRequest(config: Configuration, mode: 'preview' | 'process'): JobRequest {
    if (!config.sourceDir.trim()) throw new Error('请选择源文件夹');
    if (config.saveMode === 'saveAs' && !config.outputDir.trim()) throw new Error('请选择另存文件夹');
    if (config.saveMode === 'overwrite' && config.backupEnabled && !config.backupDir.trim()) throw new Error('请选择备份文件夹');
    return { mode, folder: config.sourceDir.trim().replace(/^"|"$/g, ''), pipeline: config.pipeline,
        ...(config.saveMode === 'saveAs' ? { outputDir: config.outputDir.trim().replace(/^"|"$/g, '') } :
            config.backupEnabled ? { backupDir: config.backupDir.trim().replace(/^"|"$/g, '') } : {}) };
}
