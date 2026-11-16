// 原生 E2E 辅助：SelectBox 的选项由 Reka UI 渲染在 body 上，不能再用原生 selectOption。
import type { Locator, Page } from '@playwright/test';

/** 点开标签对应的下拉框，再按核心 ID 点选项；等列表关闭后返回。 */
export async function pickOption(page: Page, scope: Page | Locator, label: string, value: string) {
    await scope.getByLabel(label, { exact: true }).click();
    await page.locator(`[role="option"][data-value="${value}"]`).click();
    await page.locator('[role="listbox"]').waitFor({ state: 'detached' });
}
