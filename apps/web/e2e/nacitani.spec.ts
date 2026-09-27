import { expect, test } from '@playwright/test'

/**
 * Stavy načítání. Kostry `loading.tsx` se v prohlížeči nedají spolehlivě
 * vyvolat — zdržení sítě jen odloží přechod, místo aby ukázalo kostru —,
 * proto je na ně jednotkový test v `packages/ui`. Tady se ověřuje to, co
 * jde: že se kostra u rychlé odpovědi neukáže.
 *
 * Hromadné mazání s vlastním „Mažu…“ popiskem tlačítka bylo jen v bance
 * otázek přes celou knihovnu; ta se zrušila a v tématu bulk mazání nemá
 * náhradu (jen jednotlivé „Smazat“ u karty), takže ten scénář zmizel s ní.
 */
test.describe('stavy načítání', () => {
  test('kostra se u rychlé odpovědi nestihne ukázat', async ({ page }) => {
    // Bez zdržení musí kostra zůstat průhledná: má nastavené zpoždění, takže
    // se u běžně rychlé stránky vůbec neprojeví.
    await page.goto('/tests')
    const skeleton = page.locator('[data-slot="loading"]')
    if ((await skeleton.count()) > 0) {
      await expect(skeleton.first()).not.toBeVisible()
    }
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })
})
