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

test('správce vidí záložku AI kvalita s čísly ze zkušebních dat', async ({ page }) => {
  await page.goto('/sprava')
  await page.getByRole('tab', { name: 'AI kvalita' }).click()

  // Seed (`scripts/seed-e2e.ts`) založí čtyři otázky modelu „e2e:model-a“,
  // z toho dvě přegenerované s důvodem „Moc těžká“ — přehled na nich musí
  // ukázat konkrétní čísla, ne jen to, že se něco vypsalo.
  const radekModelu = page.locator('[data-slot="card"]').filter({ hasText: 'e2e:model-a' })
  await expect(radekModelu).toContainText('vygenerováno 4')
  await expect(radekModelu).toContainText('přegenerováno 2')
  await expect(radekModelu).toContainText('50 %')

  const radekDuvodu = page.locator('[data-slot="card"]').filter({ hasText: 'Moc těžká' })
  await expect(radekDuvodu).toContainText('2×')

  const radekPredmetu = page.locator('[data-slot="card"]').filter({ hasText: 'PŘÍRODOPIS' })
  await expect(radekPredmetu).toContainText('2×')
  await expect(radekPredmetu).toContainText('moc těžká')
})

test('správce udělá z důvodu pravidlo promptu a pak ho vypne', async ({ page }) => {
  await page.goto('/sprava')
  await page.getByRole('tab', { name: 'AI kvalita' }).click()

  // Ze seedu (viz test výše) je tu důvod „Moc těžká" — z toho vznikne pravidlo.
  const radekDuvodu = page.locator('[data-slot="card"]').filter({ hasText: 'Moc těžká' })
  await radekDuvodu.getByRole('button', { name: 'Udělat z toho pravidlo' }).click()

  await expect(page.getByRole('heading', { name: /Nové pravidlo z důvodu/ })).toBeVisible()
  await page.getByRole('button', { name: 'Uložit pravidlo' }).click()

  const radekPravidla = page.locator('[data-slot="card"]').filter({ hasText: 'Pravidla promptu školy' })
  await expect(radekPravidla).toContainText('1/10 aktivních')
  await expect(radekPravidla).toContainText('Aktivní')

  await radekPravidla.getByRole('button', { name: 'Vypnout' }).click()
  await expect(radekPravidla).toContainText('0/10 aktivních')
  await expect(radekPravidla).toContainText('Vypnuté')
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
