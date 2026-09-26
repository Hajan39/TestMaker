import { expect, test } from '@playwright/test'

/** Správcovská část: účty, události, provoz. */
test.use({ storageState: 'e2e/.auth/spravce.json' })

test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL?.includes('3101'),
    'Spouštěj přes: pnpm exec playwright test -c playwright.login.config.ts',
  )
})

test('správce založí účet, dostane jednorázové heslo a pak ho zablokuje', async ({ page }) => {
  // Doména musí vypadat jako doména: `@localhost` by neprošel kontrolou tvaru.
  const email = `nova-${Date.now()}@skola.cz`

  await page.goto('/sprava')
  await expect(page.getByRole('heading', { name: /^Správa/ })).toBeVisible()

  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Jméno').fill('Nová učitelka')
  await page.getByRole('button', { name: 'Založit účet' }).click()

  // Heslo se ukáže jednou a jen tady — správce ho předá osobně.
  await expect(page.getByText(`Heslo pro ${email}`)).toBeVisible()
  await expect(page.getByText(email).first()).toBeVisible()

  // Karta účtu, ne libovolný `div`: jinak locator trefí i celou stránku.
  const radek = page.locator('[data-slot="card"]').filter({ hasText: email })
  await radek.getByRole('button', { name: 'Zablokovat' }).click()
  await expect(radek.getByText('Zablokovaný')).toBeVisible()
})

test('události ukazují, co se v aplikaci dělo', async ({ page }) => {
  await page.goto('/sprava')
  await page.getByRole('tab', { name: 'Události a chyby' }).click()
  // Přihlášení zkušebních účtů se zapsalo — jinak by záznam nebyl k ničemu.
  await expect(page.getByText('prihlaseni').first()).toBeVisible()
})

test('správce vidí záložku AI kvalita', async ({ page }) => {
  await page.goto('/sprava')
  await page.getByRole('tab', { name: 'AI kvalita' }).click()
  // Bez zkušebních dat z regenerace jde vidět prázdný stav; pokud se do
  // testovací databáze mezitím dostala zpětná vazba, ukáže se rovnou tabulka
  // modelů — obojí je v pořádku, hlavní je, že záložka vůbec existuje a
  // nespadne.
  const prazdnyStav = page.getByText('Zatím žádná zpětná vazba.')
  const modely = page.getByText('Modely')
  await expect(prazdnyStav.or(modely)).toBeVisible()
})

test('učitelka se do správy vůbec nedostane', async ({ browser }) => {
  const context = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json' })
  const page = await context.newPage()
  await page.goto('/sprava')
  // Hrubé síto v proxy pustí dál jen správce — učitelku vrátí na úvod dřív,
  // než by uviděla jakoukoli záložku.
  await expect(page).toHaveURL(/\/$/)
  await context.close()
})
