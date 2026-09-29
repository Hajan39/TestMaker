import { expect, test, type Page } from '@playwright/test'

/**
 * Administrátor nad školami: přepíná se v liště, v cizí škole vidí i soukromé
 * písemky a zakládá školy. Správce upraví jen svou školu a do administrace
 * se nedostane. Data staví `scripts/seed-e2e.ts` (druhá škola, učitelka C
 * a její soukromá písemka).
 *
 * Testy jdou po sobě (`workers: 1`) a druhý čte událost, kterou zapsal první.
 */
const SOUKROMA_PISEMKA_C = 'Soukromá písemka učitelky C'

test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL?.includes('3101'),
    'Spouštěj přes: pnpm exec playwright test -c playwright.login.config.ts',
  )
})

async function prepnoutDo(page: Page, skola: string) {
  await page.getByRole('button', { name: /^Škola:/ }).click()
  await page.getByRole('menuitem', { name: skola }).click()
  await expect(page.getByRole('button', { name: `Škola: ${skola}` })).toBeVisible()
}

test.describe('administrátor', () => {
  test.use({ storageState: 'e2e/.auth/administrator.json' })

  test('přepne se do druhé školy a vidí soukromou písemku tamní učitelky', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Škola: Vývoj' })).toBeVisible()

    await prepnoutDo(page, 'Druhá škola')
    await expect(page.getByText('Cizí škola')).toBeVisible()

    await page.goto('/tests')
    await expect(page.getByText(SOUKROMA_PISEMKA_C)).toBeVisible()

    // Zpátky domů, ať další testy začínají ve výchozím stavu.
    await prepnoutDo(page, 'Vývoj')
    await expect(page.getByText('Cizí škola')).toHaveCount(0)
  })

  test('založí školu a ta se objeví v přepínači', async ({ page }) => {
    const nazev = `ZŠ Zkušební ${Date.now()}`
    await page.goto('/administrace')
    const nova = page.locator('[data-slot="card"]').filter({ hasText: 'Nová škola' })
    await nova.getByLabel('Název školy').fill(nazev)
    await nova.getByRole('button', { name: 'Založit školu' }).click()

    await expect(page.getByRole('heading', { name: nazev })).toBeVisible()
    await page.getByRole('button', { name: /^Škola:/ }).click()
    await expect(page.getByRole('menuitem', { name: nazev })).toBeVisible()
  })
})

test.describe('správce druhé školy', () => {
  test.use({ storageState: 'e2e/.auth/spravceB.json' })

  test('v záznamu vidí, že se k nim přepnul administrátor', async ({ page }) => {
    await page.goto('/sprava')
    await page.getByRole('tab', { name: 'Události a chyby' }).click()
    const udalost = page.getByText('administrator-prepnul-skolu').first()
    await expect(udalost).toBeVisible()
    await expect(page.getByText('Administrátor', { exact: true }).first()).toBeVisible()
  })
})

test.describe('správce', () => {
  test.use({ storageState: 'e2e/.auth/spravce.json' })

  test('upraví doménu své školy', async ({ page }) => {
    await page.goto('/sprava')
    const skola = page.locator('[data-slot="card"]').filter({ hasText: 'Uložit školu' })
    await skola.getByLabel('Doména Google').fill('@Vyvoj-E2E.cz')
    await skola.getByRole('button', { name: 'Uložit školu' }).click()
    await expect(page.getByText('Škola uložena.')).toBeVisible()

    await page.reload()
    await expect(
      page.locator('[data-slot="card"]').filter({ hasText: 'Uložit školu' }).getByLabel('Doména Google'),
    ).toHaveValue('vyvoj-e2e.cz')
  })

  test('do administrace se nedostane a administrátora přidělit nemůže', async ({ page }) => {
    await page.goto('/administrace')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: /^Škola:/ })).toHaveCount(0)

    await page.goto('/sprava')
    await page.getByLabel('Role').click()
    await expect(page.getByRole('option', { name: 'Učitelka' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Administrátor' })).toHaveCount(0)
  })
})

test.describe('učitelka první školy', () => {
  test.use({ storageState: 'e2e/.auth/ucitelkaA.json' })

  test('nevidí nic z druhé školy', async ({ page }) => {
    await page.goto('/tests')
    await expect(page.getByRole('heading').first()).toBeVisible()
    await expect(page.getByText(SOUKROMA_PISEMKA_C)).toHaveCount(0)
  })
})
