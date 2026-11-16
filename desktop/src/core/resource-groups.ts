import type { ResourceType } from './types';

// 分组只读核心的 kind，不从扩展名推测，也不改变格式 ID 或步骤适配。
const names: Record<string, string> = { image: '图片', audio: '音频', other: '其他' };
export const resourceKindLabel = (kind: string): string => names[kind] || kind;
export function groupByResourceKind<T>(items: readonly T[], kindOf: (item: T) => string): { id: string; label: string; items: T[] }[] {
    const groups = new Map<string, T[]>();
    for (const item of items) {
        const kind = kindOf(item);
        if (!groups.has(kind)) groups.set(kind, []);
        groups.get(kind)!.push(item);
    }
    const order = (kind: string) => kind === 'image' ? 0 : kind === 'audio' ? 1 : 2;
    return [...groups].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
        .map(([id, values]) => ({ id, label: resourceKindLabel(id), items: values }));
}
export const resourceGroups = (types: readonly ResourceType[]) => groupByResourceKind(types, type => type.kind);
