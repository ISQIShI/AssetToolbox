// 外观：浅色或深色，默认跟随系统。只在 <html data-theme> 上切换，颜色全部由 tokens.css 的同名令牌给出。
// 选择保存在 WebView 的 localStorage 中，属于界面偏好，不进入核心配置。
import { computed, ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'asset-toolbox.theme';
const choices: ThemeChoice[] = ['system', 'light', 'dark'];

function stored(): ThemeChoice {
    try { const value = localStorage.getItem(KEY); return choices.includes(value as ThemeChoice) ? value as ThemeChoice : 'system'; } catch { return 'system'; }
}
const systemQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : undefined;
const systemDark = ref(Boolean(systemQuery?.matches));

export const theme = ref<ThemeChoice>(stored());
/** 当前实际显示的是否为深色。 */
export const dark = computed(() => theme.value === 'dark' || (theme.value === 'system' && systemDark.value));
export const themeLabel = computed(() => `${dark.value ? '深色' : '浅色'}${theme.value === 'system' ? '（跟随系统）' : ''}`);

function apply() {
    document.documentElement.dataset.theme = dark.value ? 'dark' : 'light';
    // 原生窗口的主题跟着界面走：系统绘制的 Mica 材质与窗口边框才会和界面同为浅色或深色。
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
        getCurrentWindow().setTheme(theme.value === 'system' ? null : dark.value ? 'dark' : 'light').catch(() => { /* 只影响材质明暗。 */ });
    }
}

/**
 * 每次点击都切换到另一种外观，保证一次点击就有变化。
 * 切换后的外观若与系统一致，就记为“跟随系统”，之后系统改变时继续跟随。
 */
export function toggleTheme() {
    const next = !dark.value;
    theme.value = next === systemDark.value ? 'system' : next ? 'dark' : 'light';
    try { localStorage.setItem(KEY, theme.value); } catch { /* 存储不可用时只在本次运行生效。 */ }
    apply();
}

export function initTheme() {
    apply();
    systemQuery?.addEventListener?.('change', event => { systemDark.value = event.matches; apply(); });
}
