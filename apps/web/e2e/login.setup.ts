import { expect, test as setup } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { PASSWORD, ACCOUNTS, type Person } from '../playwright.login.config'

/**
 * One sign-in per test person; the cookie is stored in `e2e/.auth` and tests
 * just pick it up (`test.use({ storageState: … })`). Without it every test
 * would click through the login screen again.
 */
export function state(person: Person): string {
  return `e2e/.auth/${person}.json`
}

for (const person of Object.keys(ACCOUNTS) as Person[]) {
  setup(`sign-in: ${person}`, async ({ page }) => {
    mkdirSync('e2e/.auth', { recursive: true })

    await page.goto('/login')
    await page.getByLabel('E-mail').fill(ACCOUNTS[person])
    await page.getByLabel('Heslo').fill(PASSWORD)
    await page.getByRole('button', { name: 'Přihlásit se' }).click()

    // A manager also has Management in the bar; the others at least the Classes item.
    await expect(page.getByRole('link', { name: 'Třídy' })).toBeVisible()
    await page.context().storageState({ path: state(person) })
  })
}
