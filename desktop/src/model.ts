import type { Configuration, Definition, RestoreFile, RestoreScope, Selection } from './types';
export function bytes(value?: number | null): string {
    if (value == null || value < 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB']; let index = 0;
    while (value >= 1024 && index < units.length - 1) { value /= 1024; index++; }
    return `${index ? value.toFixed(1) : value} ${units[index]}`;
}
export function resetParameters(config: Configuration, definition: Definition): Configuration {
    return { ...config, ...Object.fromEntries(definition.fields.filter(field => !field.isEnable).map(field => [field.key, field.default])) };
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
export function compressionRequest(config: Configuration, mode: string) {
    if (!config.sourceDir.trim()) throw new Error('请选择源文件夹');
    if (config.saveMode === 'saveAs' && !config.outputDir.trim()) throw new Error('请选择另存文件夹');
    if (config.saveMode === 'overwrite' && config.backupEnabled && !config.backupDir.trim()) throw new Error('请选择备份文件夹');
    const { version, sourceDir, outputDir, backupDir, saveMode, backupEnabled, ...options } = config;
    return { mode, folder: config.sourceDir.trim().replace(/^"|"$/g, ''), options,
        ...(config.saveMode === 'saveAs' ? { outputDir: config.outputDir.trim().replace(/^"|"$/g, '') } :
            config.backupEnabled ? { backupDir: config.backupDir.trim().replace(/^"|"$/g, '') } : {}) };
}
