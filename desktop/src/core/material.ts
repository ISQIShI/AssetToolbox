// 窗口材质：Windows 11 上让窗口框架（标题栏、活动栏、状态栏）透出系统的 Mica 背景。
// 原生窗口在 tauri.conf.json 中声明为透明并请求 Mica；这里只负责判断系统是否真的支持，
// 支持时给 <html> 加 data-material='mica'，tokens.css 据此把 --chrome 改为透明。
// 不支持（Windows 10、浏览器调试、组件测试）时什么都不做，框架保持不透明的 --chrome。

interface UserAgentData { platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<{ platformVersion?: string }> }

/** Windows 11 的 platformVersion 主版本号不小于 13；Windows 10 为 1–10。 */
export function supportsMica(platform: string | undefined, platformVersion: string | undefined): boolean {
    return platform === 'Windows' && Number(String(platformVersion ?? '').split('.')[0]) >= 13;
}

export async function initMaterial() {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    try {
        const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
        const values = await data?.getHighEntropyValues?.(['platformVersion']);
        if (supportsMica(data?.platform, values?.platformVersion)) document.documentElement.dataset.material = 'mica';
    } catch { /* 取不到版本时保持不透明框架。 */ }
}
