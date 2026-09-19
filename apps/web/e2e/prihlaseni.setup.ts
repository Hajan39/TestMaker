import { expect, test as setup } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { HESLO, UCTY, type Osoba } from '../playwright.login.config'

/**
 * Jedno přihlášení za každou zkušební osobu; cookie se uloží do `e2e/.auth`
 * a testy si ji jen vyzvednou (`test.use({ storageState: … })`). Bez toho by
 * se každý test proklikával přihlašovací obrazovkou znovu.
 */
export function stav(osoba: Osoba): string {
  return `e2e/.auth/${osoba}.json`
}

for (const osoba of Object.keys(UCTY) as Osoba[]) {
  setup(`přihlášení: ${osoba}`, async ({ page }) => {
    mkdirSync('e2e/.auth', { recursive: true })

    await page.goto('/login')
    await page.getByLabel('E-mail').fill(UCTY[osoba])
    await page.getByLabel('Heslo').fill(HESLO)
    await page.getByRole('button', { name: 'Přihlásit se' }).click()

    // Správce má v liště navíc Správu; ostatní aspoň Banku otázek.
    await expect(page.getByRole('link', { name: 'Banka otázek' })).toBeVisible()
    await page.context().storageState({ path: stav(osoba) })
  })
}
