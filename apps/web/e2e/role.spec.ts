import { expect, test } from '@playwright/test'

/**
 * Role `nahled`: čte a tiskne, ale nic nemění. Brána zapisující požadavky
 * zastaví tak jako tak — tady se ověřuje ta srozumitelnější polovina, tedy
 * že rozhraní nenabízí tlačítka, která by stejně skončila odmítnutím.
 */
test.use({ storageState: 'e2e/.auth/nahled.json' })

test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL?.includes('3101'),
    'Spouštěj přes: pnpm exec playwright test -c playwright.login.config.ts',
  )
})

test('náhled si knihovnu prohlíží, ale nic v ní nezaloží ani nesmaže', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Banka otázek' })).toBeVisible()

  // Import a generování jsou cesty k zápisu — náhledu se vůbec nenabízejí.
  await expect(page.getByRole('link', { name: 'Import materiálů' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Generování' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Správa' })).toHaveCount(0)

  await expect(page.getByRole('button', { name: /Nový předmět/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Smazat předmět/ })).toHaveCount(0)
})

test('zápis odmítne i server, ne jen skryté tlačítko', async ({ page }) => {
  const odpoved = await page.request.post('/api/library', {
    data: { kind: 'subject', name: 'Náhled sem nesmí' },
  })
  expect(odpoved.status()).toBe(403)
})

test('do správy se náhled nedostane', async ({ page }) => {
  await page.goto('/sprava')
  // Brána ho vrátí na úvodní obrazovku.
  await expect(page).toHaveURL(/\/$/)
})
