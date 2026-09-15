import { expect, test } from '@playwright/test'

/**
 * Osnova testu: co jde u jednotlivé položky nastavit jen pro tenhle test,
 * aniž by se měnila otázka v bance.
 */
test.describe('položka osnovy', () => {
  test('u volné odpovědi jde nastavit počet řádků a uloží se s testem', async ({ page }) => {
    await page.goto('/tests/new')
    await page.getByText('jen schválené').click()
    await page.locator('details summary').first().click()

    // Najdeme volnou odpověď — jen ta má v testu smysl u počtu řádků.
    const openQuestion = page
      .locator('details[open] > ul > li')
      .filter({ hasText: 'Volná odpověď' })
      .first()
    await openQuestion.getByRole('checkbox').click()

    const lines = page.getByLabel('Řádků na odpověď')
    await expect(lines).toBeVisible()
    await lines.fill('9')

    // Název je v postranním panelu s nastavením testu.
    await page.getByRole('button', { name: 'Nastavení' }).click()
    await page.getByLabel('Název testu').fill('Zkouška počtu řádků')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Uložit' }).click()
    // Po uložení se adresa změní na detail testu (pozor: „/tests/new" by
    // obecnému vzoru taky vyhovělo).
    await page.waitForURL((url) => /\/tests\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'))

    // Načteme uložený test znovu z adresy (ne `reload`: po klientském
    // přesměrování míří obnovení pořád na /tests/new).
    await page.goto(page.url())
    await expect(page.getByLabel('Řádků na odpověď')).toHaveValue('9')
  })
})
