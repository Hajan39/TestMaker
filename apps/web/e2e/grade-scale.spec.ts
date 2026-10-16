import { expect, test, type Page } from '@playwright/test'

/** The school's grade scale in Správa → Hodnocení. */

test.afterEach(async ({ request }) => {
  // Other specs print keys from the same database — leave the built-in table there.
  const response = await request.put('/api/sprava/hodnoceni', { data: { scale: null } })
  expect(response.status()).toBe(200)
})

async function openGrades(page: Page) {
  await page.goto('/sprava')
  await page.getByRole('tab', { name: 'Hodnocení' }).click()
  await expect(page.getByTestId('grade-scale-status')).toBeVisible()
}

test('a manager corrects a value, saves it, sees it after reload and resets to the default', async ({ page }) => {
  await openGrades(page)
  await expect(page.getByTestId('grade-scale-status')).toHaveAttribute('data-custom', 'false')
  const gradeOneTo = page.getByLabel('45 bodů, známka 1, do')
  await expect(gradeOneTo).toHaveValue('41')

  // A gap between grades 1 and 2 is refused with a sentence, not saved.
  await gradeOneTo.fill('43')
  await page.getByRole('button', { name: 'Uložit', exact: true }).click()
  await expect(page.getByTestId('grade-scale-errors')).toContainText(
    '45 bodů: Mezi známkou 1 a 2 chybí body – známka 2 má začínat na 42.',
  )
  // The gap is marked where the worse grade should start.
  await expect(page.getByLabel('45 bodů, známka 2, od')).toHaveAttribute('aria-invalid', 'true')

  // Ending grade 1 where grade 2 starts is the shared point the school table allows.
  await gradeOneTo.fill('40')
  await page.getByRole('button', { name: 'Uložit', exact: true }).click()
  await expect(page.getByTestId('toast-grades-saved')).toBeVisible()

  await page.reload()
  await expect(page.getByLabel('45 bodů, známka 1, do')).toHaveValue('40')
  await expect(page.getByTestId('grade-scale-status')).toHaveAttribute('data-custom', 'true')

  await page.getByRole('button', { name: 'Vrátit výchozí' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Vrátit výchozí' }).click()
  await expect(page.getByLabel('45 bodů, známka 1, do')).toHaveValue('41')

  await page.reload()
  await expect(page.getByLabel('45 bodů, známka 1, do')).toHaveValue('41')
  await expect(page.getByTestId('grade-scale-status')).toHaveAttribute('data-custom', 'false')
})

test('a new row is prefilled from the percentages and can be removed', async ({ page }) => {
  await openGrades(page)
  await page.getByLabel('Nový řádek – počet bodů').fill('50')
  await page.getByRole('button', { name: 'Přidat řádek' }).click()
  // 50 points at 90 / 75 / 45 / 25 %: grade 2 runs 44–38.
  await expect(page.getByLabel('50 bodů, známka 2, od')).toHaveValue('44')
  await expect(page.getByLabel('50 bodů, známka 2, do')).toHaveValue('38')

  await page.getByRole('button', { name: 'Odebrat řádek 50 bodů' }).click()
  await expect(page.getByLabel('50 bodů, známka 2, od')).toHaveCount(0)
})

test('on a phone the table scrolls inside its box, not the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openGrades(page)
  const box = page.locator('[data-slot="table-container"]')
  const overflow = await box.evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow).toBeGreaterThan(0)
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(pageOverflow).toBe(0)
})
