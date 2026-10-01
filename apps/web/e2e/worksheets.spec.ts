import { expect, test } from '@playwright/test'

/**
 * Worksheets: manual creation and editing, printing, separation from tests,
 * the "ověř" flag and the generation form.
 *
 * Generation is tested with a faked route response (`page.route`) — the server
 * part is covered by unit tests. The "Vygenerovat" button is visible only when
 * a model is configured; in a normal test run it is not and that test is
 * skipped. It can be run with a made-up key, the model is not called anyway:
 * `AI_MODELS=google:x GOOGLE_GENERATIVE_AI_API_KEY=e2e pnpm exec playwright test e2e/worksheets.spec.ts`
 */

/** The finished worksheet from `scripts/seed-e2e.ts`. */
const SEED_LIST_ID = 'e2e-pracovni-list'
const SEED_LIST_TITLE = 'E2E pracovní list o fotosyntéze'

test.describe('worksheets', () => {
  test('a manual worksheet with a fun fact and a table saves and prints with the key', async ({ page }) => {
    const name = `E2E list o sopkách ${Date.now()}`
    await page.goto('/listy/new')
    await page.getByRole('tab', { name: 'Volné zadání' }).click()
    await page.getByLabel('O čem má list být').fill(name)
    await page.getByRole('button', { name: 'Založit prázdný list' }).click()

    await expect(page).toHaveURL(/\/listy\/[^/]+$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Úprava pracovního listu' })).toBeVisible()
    const id = new URL(page.url()).pathname.split('/').at(-1)!

    await page.getByRole('button', { name: '+ Fun fact' }).click()
    await page.getByLabel('Text fun factu').fill('Etna je nejvyšší činná sopka Evropy.')
    await page.getByRole('button', { name: '+ Tabulka' }).click()
    await page.getByLabel('Buňka 1. řádku, 1. sloupce').fill('Etna')
    await page.getByLabel('Buňka 1. řádku, 2. sloupce').fill('Itálie')
    await page.getByLabel('Buňka 2. řádku, 1. sloupce').fill('Fudži')
    await page.getByLabel('Buňka 2. řádku, 2. sloupce').fill('Japonsko')

    const saved = page.waitForResponse(
      (response) => response.url().endsWith('/api/tests') && response.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: 'Uložit', exact: true }).click()
    expect((await saved).ok()).toBe(true)

    // After reloading everything is in place.
    await page.reload()
    await expect(page.getByLabel('Text fun factu')).toHaveValue('Etna je nejvyšší činná sopka Evropy.')
    await expect(page.getByLabel('Buňka 1. řádku, 2. sloupce')).toHaveValue('Itálie')

    for (const url of [`/api/tests/${id}/pdf?variant=A`, `/api/tests/${id}/pdf?variant=A&key=1`]) {
      const pdf = await page.request.get(url)
      expect(pdf.ok(), url).toBe(true)
      expect(pdf.headers()['content-type']).toBe('application/pdf')
      expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-')
    }
  })

  test('a worksheet is not among tests and a test is not among worksheets', async ({ page }) => {
    const testTitle = `E2E písemka mimo listy ${Date.now()}`
    const created = await page.request.post('/api/tests', {
      data: {
        title: testTitle,
        templateId: 'builtin-klasicka',
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        items: [],
      },
    })
    expect(created.ok()).toBe(true)

    await page.goto(`/tests?q=${encodeURIComponent(SEED_LIST_TITLE)}`)
    await expect(page.getByRole('link', { name: SEED_LIST_TITLE })).toHaveCount(0)
    await page.goto(`/listy?q=${encodeURIComponent(SEED_LIST_TITLE)}`)
    await expect(page.getByRole('link', { name: SEED_LIST_TITLE })).toBeVisible()

    await page.goto(`/listy?q=${encodeURIComponent(testTitle)}`)
    await expect(page.getByRole('link', { name: testTitle })).toHaveCount(0)
    await page.goto(`/tests?q=${encodeURIComponent(testTitle)}`)
    await expect(page.getByRole('link', { name: testTitle })).toBeVisible()

    // A worksheet detail under the tests route redirects to where it belongs.
    await page.goto(`/tests/${SEED_LIST_ID}`)
    await expect(page).toHaveURL(new RegExp(`/listy/${SEED_LIST_ID}$`))
  })

  test('the ověř flag is cleared by a click and the warning disappears', async ({ page }) => {
    await page.goto(`/listy/${SEED_LIST_ID}`)
    await expect(page.getByText('Ke kontrole: 1 položka')).toBeVisible()
    await page.getByRole('button', { name: /^ověř — odškrtnout/ }).click()
    await expect(page.getByRole('button', { name: /^ověř — odškrtnout/ })).toHaveCount(0)
    await expect(page.getByText(/Ke kontrole:/)).toHaveCount(0)
  })

  test('without a model the form offers only an empty worksheet and explains why', async ({ page }) => {
    await page.goto('/listy/new')
    const generate = page.getByRole('button', { name: 'Vygenerovat' })
    test.skip(await generate.isVisible(), 'A model is configured on the test server.')
    await expect(page.getByText(/Generování listu není nastavené/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Založit prázdný list' })).toBeVisible()
  })

  test('after generating it shows how many items were skipped', async ({ page }) => {
    await page.route('**/api/worksheets/generate', async (route) => {
      await route.fulfill({ json: { id: SEED_LIST_ID, dropped: 2, models: ['google:x'] } })
    })
    await page.goto('/listy/new')
    const generate = page.getByRole('button', { name: 'Vygenerovat' })
    test.skip(!(await generate.isVisible()), 'No model is configured on the test server.')

    await page.getByRole('tab', { name: 'Volné zadání' }).click()
    await page.getByLabel('O čem má list být').fill('Fotosyntéza')
    await page.getByLabel('Pokyn pro model (nepovinné)').fill('víc tabulek')
    await generate.click()

    await expect(page).toHaveURL(new RegExp(`/listy/${SEED_LIST_ID}\\?vynechano=2$`), { timeout: 30_000 })
    await expect(page.getByText('2 položky model nevrátil v pořádku a vynechaly se.', { exact: false })).toBeVisible()
    // With a configured model every piece can be regenerated.
    await expect(page.getByRole('button', { name: 'Přegenerovat' }).first()).toBeAttached()
  })
})
