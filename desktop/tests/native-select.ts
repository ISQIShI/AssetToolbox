// 原生 E2E 辅助：SelectBox 的选项由 Reka UI 渲染在 body 上，不能再用原生 selectOption。
import type { Locator, Page } from '@playwright/test';

/** 点开标签对应的下拉框，再按核心 ID 点选项；等列表关闭后返回。 */
export async function pickOption(page: Page, scope: Page | Locator, label: string, value: string) {
    await scope.getByLabel(label, { exact: true }).click();
    await page.locator('[role="listbox"], .cascade-root').waitFor({ state: 'visible' });
    // 浮层可先出现、条目随后挂载。直接等待目标叶子或含目标的分支，避免 all()/isVisible() 的瞬时快照竞争。
    const target = page.locator(`[role="option"][data-value="${value}"]:visible, [role="menuitemradio"][data-value="${value}"]:visible, .cascade-branch[data-state="closed"][data-values*='"${value}"']:visible`).first();
    for (let depth = 0; depth < 8; depth++) {
        await target.waitFor({ state: 'visible', timeout: 15000 });
        if (await target.getAttribute('data-value') === value) {
            const leaf = page.locator(`[role="option"][data-value="${value}"], [role="menuitemradio"][data-value="${value}"]`);
            if (await leaf.getAttribute('role') === 'menuitemradio') {
                await leaf.scrollIntoViewIfNeeded();
                const rect = (await leaf.boundingBox())!;
                // 子菜单翻到左侧时，保留真实鼠标移动方向，供菜单的悬停容错区判断；不能从父项瞬移到另一侧。
                await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 32 });
            }
            await leaf.click({ timeout: 15000 });
            break;
        }
        const branchId = await target.getAttribute('id');
        await page.locator(`[id="${branchId}"]`).click();
    }
    await page.locator('[role="listbox"]').waitFor({ state: 'detached' });
    await page.locator('.cascade-root').waitFor({ state: 'detached' });
}
