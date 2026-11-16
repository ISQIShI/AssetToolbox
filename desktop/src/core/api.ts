import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';

// `npm run dev:web` 在普通浏览器中运行时没有 Tauri；此时改用模拟核心，便于调试界面。
// 判断条件在生产构建中恒为假，模拟代码不会进入发布产物。
const browserPreview = import.meta.env.DEV && typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window);
const preview = () => import('./preview-core');

export async function call<T>(action: string, payload: unknown = {}): Promise<T> {
    if (browserPreview) return (await preview()).call(action, payload) as T;
    return invoke('core_call', { action, payload });
}

export async function chooseFolder(title: string, defaultPath?: string): Promise<string | null> {
    if (browserPreview) return (await preview()).chooseFolder(title);
    return open({ title, directory: true, multiple: false, ...(defaultPath ? { defaultPath } : {}) });
}

/** 路径是否为现有文件夹；用于校验拖入窗口的内容。 */
export async function isDirectory(path: string): Promise<boolean> {
    if (browserPreview) return true;
    return invoke('is_directory', { path });
}

export interface FolderDropEvent { type: 'over' | 'leave' | 'drop'; paths: string[] }
/** 监听从资源管理器拖入窗口的文件；没有原生窗口时不做任何事。返回取消监听的函数。 */
export async function onFolderDrop(handler: (event: FolderDropEvent) => void): Promise<() => void> {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return () => {};
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    return getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type === 'drop') handler({ type: 'drop', paths: payload.paths });
        else handler({ type: payload.type === 'leave' ? 'leave' : 'over', paths: [] });
    });
}

export async function openReport(id: string): Promise<void> {
    if (browserPreview) return;
    return invoke('open_report', { id });
}

export async function openProviderSource(id: string): Promise<void> {
    if (browserPreview) return;
    return invoke('open_provider_source', { id });
}
