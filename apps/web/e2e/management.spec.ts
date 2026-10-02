import { expect, test } from '@playwright/test'

/** The management part: accounts, events, operations. */
test.use({ storageState: 'e2e/.auth/spravce.json' })

test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL?.includes('3101'),
    'Spouštěj přes: pnpm exec playwright test -c playwright.login.config.ts',
  )
})

test('a manager creates an account, gets a one-time password and then blocks it', async ({ page }) => {
  // The domain must look like a domain: `@localhost` would fail the format check.
  const email = `nova-${Date.now()}@skola.cz`

  await page.goto('/sprava')
  await expect(page.getByRole('heading', { name: /^Správa/ })).toBeVisible()

  // `exact`: the school form also has "E-mail školy".
  await page.getByLabel('E-mail', { exact: true }).fill(email)
  await page.getByLabel('Jméno').fill('Nová učitelka')
  await page.getByRole('button', { name: 'Založit účet' }).click()

  // The password is shown once and only here — the manager hands it over in person.
  const passwordDialog = page.getByRole('dialog')
  await expect(passwordDialog.getByText(`Heslo pro ${email}`)).toBeVisible()
  await passwordDialog.getByRole('button', { name: 'Hotovo' }).click()
  await expect(page.getByText(email).first()).toBeVisible()

  // The account card, not any `div`: otherwise the locator would hit the whole page too.
  const row = page.locator('[data-slot="card"]').filter({ hasText: email })
  await row.getByRole('button', { name: 'Zablokovat' }).click()
  // Blocking signs the teacher out, so it is confirmed first.
  await page.getByRole('alertdialog').getByRole('button', { name: 'Zablokovat' }).click()
  await expect(row.getByText('Zablokovaný')).toBeVisible()
})

test('events show what happened in the app', async ({ page }) => {
  await page.goto('/sprava')
  await page.getByRole('tab', { name: 'Události a chyby' }).click()
  // Sign-ins of the test accounts were logged — otherwise the log would be useless.
  await expect(page.getByText('Přihlášení', { exact: true }).first()).toBeVisible()
})

test('a manager sees the AI quality tab with numbers from the test data', async ({ page }) => {
  await page.goto('/sprava')
  await page.getByRole('tab', { name: 'AI kvalita' }).click()

  // The seed (`scripts/seed-e2e.ts`) creates four questions of model "e2e:model-a",
  // two of them regenerated with the reason "Moc těžká" — the overview must show
  // concrete numbers for them, not just that something was listed.
  const modelRowEl = page.locator('[data-slot="card"]').filter({ hasText: 'e2e:model-a' })
  await expect(modelRowEl).toContainText('vygenerováno 4')
  await expect(modelRowEl).toContainText('přegenerováno 2')
  await expect(modelRowEl).toContainText('50 %')

  // By the card heading, not by "Moc těžká" — that repeats in the subjects
  // card too ("nejčastěji moc těžká") and would match both.
  const reasonCard = page.locator('[data-slot="card"]').filter({ hasText: 'Nejčastější důvody přegenerování' })
  await expect(reasonCard).toContainText('Moc těžká')
  await expect(reasonCard).toContainText('2×')

  const subjectCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: 'Předměty s nejvíc přegenerováním' })
  await expect(subjectCard).toContainText('PŘÍRODOPIS')
  await expect(subjectCard).toContainText('2×')
  await expect(subjectCard).toContainText('moc těžká')
})

test('a manager turns a reason into a prompt rule and then disables it', async ({ page }) => {
  await page.goto('/sprava')
  await page.getByRole('tab', { name: 'AI kvalita' }).click()

  // From the seed (see the test above) there is the reason "Moc těžká" — the rule comes from it.
  const reasonRow = page.locator('[data-slot="card"]').filter({ hasText: 'Moc těžká' })
  await reasonRow.getByRole('button', { name: 'Udělat z toho pravidlo' }).click()

  await expect(page.getByRole('heading', { name: /Nové pravidlo z důvodu/ })).toBeVisible()
  // The editor is prefilled with the general rule for every further generation
  // (`rule`), not with the sentence about this particular replacement (`hint`,
  // which speaks of "the previous version" and does not belong in a lasting rule).
  await expect(page.getByRole('textbox')).toHaveValue('Otázky drž spíš na spodní hranici náročnosti ročníku.')
  await page.getByRole('button', { name: 'Uložit pravidlo' }).click()

  const ruleRow = page.locator('[data-slot="card"]').filter({ hasText: 'Pravidla promptu školy' })
  await expect(ruleRow).toContainText('1/10 aktivních')
  await expect(ruleRow).toContainText('Aktivní')
  await expect(ruleRow).toContainText('Otázky drž spíš na spodní hranici náročnosti ročníku.')

  await ruleRow.getByRole('button', { name: 'Vypnout' }).click()
  await expect(ruleRow).toContainText('0/10 aktivních')
  await expect(ruleRow).toContainText('Vypnuté')
})

test('a teacher does not get into management at all', async ({ browser }) => {
  const context = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json' })
  const page = await context.newPage()
  await page.goto('/sprava')
  // The coarse filter in the proxy lets only a manager through — it sends the
  // teacher back home before she would see any tab.
  await expect(page).toHaveURL(/\/$/)
  await context.close()
})
