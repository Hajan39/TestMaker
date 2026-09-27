import { expect, test } from '@playwright/test'
import { HESLO, UCTY } from '../playwright.login.config'

/**
 * Přihlášení a odhlášení účtem. Běží jedině proti serveru se zapnutými účty,
 * který spouští `playwright.login.config.ts` na portu 3101. Ve sdíleném běhu
 * (`playwright.config.ts`, port 3100, server bez přihlašování) by test neměl
 * co ověřovat, proto se tam přeskočí.
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
  await expect(page.getByRole('link', { name: 'Třídy' })).toHaveCount(0)
})

test('chybné heslo vypíše hlášku a nikam nepustí', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(UCTY.ucitelkaA)
  await page.getByLabel('Heslo').fill('uplne-jine-heslo')
  await page.getByRole('button', { name: 'Přihlásit se' }).click()
  await expect(page.getByText(/nesouhlasí/)).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('se správným heslem se přihlásí, přežije obnovení stránky a odhlásí se', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(UCTY.ucitelkaA)
  await page.getByLabel('Heslo').fill(HESLO)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('link', { name: 'Třídy' })).toBeVisible()

  // Cookie drží i po obnovení stránky.
  await page.reload()
  await expect(page).toHaveURL(/\/$/)

  // V liště je vidět, kdo je přihlášený — u jednoho počítače se ve sborovně
  // vystřídá víc lidí.
  await page.getByRole('button', { name: /Učitelka A/ }).click()
  await page.getByRole('menuitem', { name: 'Odhlásit se' }).click()
  await expect(page).toHaveURL(/\/login/)

  // Po odhlášení už dovnitř nesmí.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('po přihlášení se vrátí tam, kam uživatelka mířila', async ({ page }) => {
  await page.goto('/tests')
  await expect(page).toHaveURL(/\/login\?dal=/)

  await page.getByLabel('E-mail').fill(UCTY.ucitelkaA)
  await page.getByLabel('Heslo').fill(HESLO)
  await page.getByRole('button', { name: 'Přihlásit se' }).click()

  await expect(page).toHaveURL(/\/tests$/)
})
