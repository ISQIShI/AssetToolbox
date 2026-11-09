import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
export const call = <T>(action: string, payload: unknown = {}): Promise<T> => invoke('core_call', { action, payload });
export const chooseFolder = (title: string, defaultPath?: string): Promise<string | null> => open({ title, directory: true, multiple: false, ...(defaultPath ? { defaultPath } : {}) });
export const openReport = (id: string): Promise<void> => invoke('open_report', { id });
export const openProviderSource = (id: string): Promise<void> => invoke('open_provider_source', { id });
