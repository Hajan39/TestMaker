import { expect, test, type Page } from '@playwright/test'
import { testGradeQuery } from './fixtures'

/**
 * Pořídí snímky hlavních obrazovek do `e2e/screenshots`, aby šlo posoudit vzhled,
 * který z kódu ani z HTML poznat nejde. Nespouští se v běžném běhu.
 *
 * Snímek sám o sobě nic netvrdí, proto se u každé obrazovky ještě ověří, že
 * se opravdu vykreslila: prázdná nebo rozbitá stránka by jinak skončila jako
 * hezky pojmenovaný obrázek ničeho.
 */
test.describe('snímky obrazovek', () => {
  test.skip(!process.env.SCREENSHOTS, 'spouští se jen s proměnnou SCREENSHOTS')

  const shots = [
    { path: () => '/', name: 'knihovna', width: 1440 },
    { path: (page: Page) => testGradeQuery(page.request), name: 'rocnik', width: 1440 },
    { path: () => '/import', name: 'import', width: 1440 },
    { path: () => '/tests', name: 'testy', width: 1440 },
    { path: () => '/templates', name: 'sablony', width: 1440 },
    { path: () => '/tests/new', name: 'skladani-testu', width: 1440 },
    { path: () => '/', name: 'knihovna-1200', width: 1200 },
    { path: () => '/', name: 'knihovna-900', width: 900 },
  ]

  for (const shot of shots) {
    test(`snímek: ${shot.name}`, async ({ page }) => {
      await page.setViewportSize({ width: shot.width, height: 900 })
      const response = await page.goto(await shot.path(page))
      expect(response?.ok(), `${shot.name}: stránka se nenačetla`).toBe(true)
      await page.waitForLoadState('networkidle')

      // Stránka musí mít obsah — jinak by ze snímku byl hezky pojmenovaný
      // obrázek ničeho. (Prvek `nextjs-portal` se na testy nehodí: vývojový
      // overlay visí v DOM pořád, i když je všechno v pořádku.)
      await expect(page.locator('main')).toBeVisible()
      const text = (await page.locator('main').innerText()).trim()
      expect(text.length, `${shot.name}: obrazovka je prázdná`).toBeGreaterThan(20)

      await page.screenshot({ path: `e2e/screenshots/${shot.name}.png`, fullPage: false })
    })
  }
})
