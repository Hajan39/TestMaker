import { expect, test } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Stavy načítání. Kostry `loading.tsx` se v prohlížeči nedají spolehlivě
 * vyvolat — zdržení sítě jen odloží přechod, místo aby ukázalo kostru —,
 * proto je na ně jednotkový test v `packages/ui`. Tady se ověřuje to, co
 * jde: že se kostra u rychlé odpovědi neukáže a že tlačítko akce po dobu
 * běhu říká, co dělá.
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

  test('hromadná akce u otázek řekne, že pracuje', async ({ page }) => {
    await page.goto(await testTopicPath(page.request))

    // Zpomalíme uložení stavu, ať je vidět zablokované tlačítko.
    await page.route('**/api/questions', async (route) => {
      if (route.request().method() === 'PUT') {
        await new Promise((resolve) => setTimeout(resolve, 1200))
      }
      await route.continue()
    })

    await page.getByRole('checkbox', { name: 'Vybrat vše' }).click()
    await page.getByRole('button', { name: 'Schválit' }).click()

    // Po dobu ukládání tlačítko změní popisek a nejde na něj kliknout znovu.
    const busy = page.getByRole('button', { name: 'Schvaluji…' })
    await expect(busy).toBeVisible()
    await expect(busy).toBeDisabled()

    // Po dokončení se výběr zruší a lišta hromadných akcí zmizí.
    await expect(page.getByText(/^Vybráno \d+$/)).toHaveCount(0, { timeout: 15000 })
  })
})
