import { expect, test } from '@playwright/test'
import { HESLO } from '../playwright.login.config'

/**
 * Přihlášení a odhlášení. Běží jedině proti serveru se zapnutým heslem, který
 * spouští `playwright.login.config.ts` na portu 3101. Ve sdíleném běhu
 * (`playwright.config.ts`, port 3100, server bez hesla) by test neměl co
 * ověřovat, proto se tam přeskočí.
 */
test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL?.includes('3101'),
    'Spouštěj přes: pnpm exec playwright test -c playwright.login.config.ts',
  )
})

test('nepřihlášenou uživatelku pustí jedině na přihlašovací stránku', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Přihlášení' })).toBeVisible()
  // Na přihlašovací stránce není navigace aplikace.
  await expect(page.getByRole('link', { name: 'Banka otázek' })).toHaveCount(0)
})

test('chybné heslo vypíše hlášku a nikam nepustí', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Heslo').fill('uplne-jine-heslo')
  await page.getByRole('button', { name: 'Přihlásit se' }).click()
  await expect(page.getByText('Heslo nesouhlasí.')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)
})

test('se správným heslem se přihlásí, přežije obnovení stránky a odhlásí se', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Heslo').fill(HESLO)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: 'Banka otázek' })).toBeVisible()

  // Cookie drží i po obnovení stránky.
  await page.reload()
  await expect(page).toHaveURL(/\/$/)

  await page.getByRole('button', { name: 'Odhlásit se' }).click()
  await expect(page).toHaveURL(/\/login$/)

  // Po odhlášení už dovnitř nesmí.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
})
