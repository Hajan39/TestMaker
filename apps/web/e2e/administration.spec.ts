import { expect, test, type Page } from '@playwright/test'

/**
 * The administrator above schools: switches in the bar, sees private tests in a
 * foreign school too and creates schools. A manager edits only their own school
 * and cannot get into administration. Data is built by `scripts/seed-e2e.ts`
 * (a second school, teacher C and her private test).
 *
 * Tests run in sequence (`workers: 1`) and the second reads an event the first wrote.
 */
const PRIVATE_TEST_C = 'Soukromá písemka učitelky C'

test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL?.includes('3101'),
    'Spouštěj přes: pnpm exec playwright test -c playwright.login.config.ts',
  )
})

async function switchInto(page: Page, school: string) {
  await page.getByRole('button', { name: /^Škola:/ }).click()
  await page.getByRole('menuitem', { name: school }).click()
  await expect(page.getByRole('button', { name: `Škola: ${school}` })).toBeVisible()
}

test.describe('administrator', () => {
  test.use({ storageState: 'e2e/.auth/administrator.json' })

  test('switches to the second school and sees a private test of a local teacher', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Škola: Vývoj' })).toBeVisible()

    await switchInto(page, 'Druhá škola')
    await expect(page.getByTestId('foreign-school-badge')).toBeVisible()

    await page.goto('/tests')
    await expect(page.getByText(PRIVATE_TEST_C)).toBeVisible()

    // Back home, so the next tests start from the default state.
    await switchInto(page, 'Vývoj')
    await expect(page.getByTestId('foreign-school-badge')).toHaveCount(0)
  })

  test('sees AI usage across all schools and switches the period', async ({ page }) => {
    await page.goto('/administrace')
    const usage = page.locator('[data-slot="card"]').filter({ hasText: 'Použití AI' })
    await expect(usage.getByRole('heading', { name: 'Použití AI' })).toBeVisible()
    // The model shows in the daily limits and in the per-model table.
    await expect(usage.getByRole('heading', { name: 'Denní limity dnes' })).toBeVisible()
    await expect(usage.getByRole('cell', { name: 'google:e2e-pouziti' })).toHaveCount(2)
    await expect(usage.getByRole('cell', { name: 'Druhá škola' })).toBeVisible()

    await usage.getByRole('link', { name: '7 dní' }).click()
    await expect(page).toHaveURL(/dni=7/)
    await expect(usage.getByRole('link', { name: '7 dní' })).toHaveAttribute('aria-current', 'page')
  })

  test('creates a school and it appears in the switcher', async ({ page }) => {
    const name = `ZŠ Zkušební ${Date.now()}`
    await page.goto('/administrace')
    const created = page.locator('[data-slot="card"]').filter({ hasText: 'Nová škola' })
    await created.getByLabel('Název školy').fill(name)
    await created.getByRole('button', { name: 'Založit školu' }).click()

    await expect(page.getByRole('heading', { name: name })).toBeVisible()
    await page.getByRole('button', { name: /^Škola:/ }).click()
    await expect(page.getByRole('menuitem', { name: name })).toBeVisible()
  })
})

test.describe('manager of the second school', () => {
  test.use({ storageState: 'e2e/.auth/spravceB.json' })

  test('sees in the log that the administrator switched to them', async ({ page }) => {
    await page.goto('/sprava')
    await page.getByRole('tab', { name: 'Události a chyby' }).click()
    const event = page.locator('[data-testid="event-label"][data-action="administrator-prepnul-skolu"]').first()
    await expect(event).toBeVisible()
    await expect(page.getByTestId('event-administrator').first()).toBeVisible()
  })
})

test.describe('manager', () => {
  test.use({ storageState: 'e2e/.auth/spravce.json' })

  test('edits the domain of their school', async ({ page }) => {
    await page.goto('/sprava')
    const school = page.locator('[data-slot="card"]').filter({ hasText: 'Uložit školu' })
    await school.getByLabel('Doména Google').fill('@Vyvoj-E2E.cz')
    await school.getByRole('button', { name: 'Uložit školu' }).click()
    await expect(page.getByTestId('toast-school-saved')).toBeVisible()

    await page.reload()
    await expect(
      page.locator('[data-slot="card"]').filter({ hasText: 'Uložit školu' }).getByLabel('Doména Google'),
    ).toHaveValue('vyvoj-e2e.cz')
  })

  test('cannot get into administration and cannot assign administrator', async ({ page }) => {
    await page.goto('/administrace')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: /^Škola:/ })).toHaveCount(0)

    await page.goto('/sprava')
    await page.getByLabel('Role').click()
    await expect(page.getByRole('option', { name: 'Učitel/ka' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Administrátor' })).toHaveCount(0)
  })
})

test.describe('teacher of the first school', () => {
  test.use({ storageState: 'e2e/.auth/ucitelkaA.json' })

  test('sees nothing of the second school', async ({ page }) => {
    await page.goto('/tests')
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expect(page.getByText(PRIVATE_TEST_C)).toHaveCount(0)
  })

  test('the AI usage overview does not exist for her', async ({ page }) => {
    const response = await page.request.get('/api/administrace/ai')
    expect(response.status()).toBe(404)
  })
})
