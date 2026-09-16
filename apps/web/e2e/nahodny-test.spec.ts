import { expect, test } from '@playwright/test'

/**
 * Sestavení písemky losem. Učitelka zaškrtne okruhy, řekne kolik toho má být
 * a aplikace jí test poskládá; do osnovy se to jen vloží, aby šlo cokoli
 * přehodit nebo smazat, a teprve pak se ukládá.
 */
test.describe('náhodně sestavený test', () => {
  test('naplní osnovu a jde uložit', async ({ page }) => {
    await page.goto('/tests/new')
    await page.getByRole('button', { name: 'Sestavit náhodně' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Dialog se musí vejít na obrazovku: seznam témat bývá dlouhý a roluje se
    // uvnitř, ne tím, že okno naroste přes celou stránku.
    const viewport = page.viewportSize()
    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeLessThanOrEqual((viewport?.height ?? 720) + 1)

    // Vybereme celou knihovnu a necháme vylosovat pět otázek.
    await dialog.getByRole('button', { name: 'Vybrat vše' }).click()
    await dialog.getByLabel('Otázek').fill('5')

    const summary = dialog.getByTestId('random-summary')
    await expect(summary).toContainText('5 otázek')

    // Jiný los dá jiný výběr; porovnáváme text prvního vylosovaného zadání.
    const first = async () => (await dialog.locator('ol li').first().innerText()).slice(0, 80)
    const before = await first()
    await dialog.getByRole('button', { name: 'Zamíchat znovu' }).click()
    await expect
      .poll(async () => (await first()) !== before, { timeout: 5000, message: 'los se nezměnil' })
      .toBe(true)

    await dialog.getByRole('button', { name: 'Vložit do osnovy' }).click()
    await expect(dialog).toBeHidden()

    // V osnově je pět otázek a test jde uložit.
    await expect(page.getByText(/^5 otázek/).first()).toBeVisible()
    await page.getByLabel('Název písemky').fill('Náhodná písemka')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await page.waitForURL((url) => /\/tests\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'))

    await page.goto(page.url())
    await expect(page.getByText(/^5 otázek/).first()).toBeVisible()
  })
})
