import { expect, test } from '@playwright/test'

/**
 * Pracovní listy: ruční založení a úprava, tisk, oddělení od písemek,
 * značka „ověř“ a formulář generování.
 *
 * Generování se zkouší s podvrženou odpovědí route (`page.route`) — serverovou
 * část pokrývají jednotkové testy. Tlačítko „Vygenerovat“ je ale vidět, jen
 * když je model nastavený; v běžném běhu testů není a ten test se přeskočí.
 * Pustit ho jde s vymyšleným klíčem, model se stejně nevolá:
 * `AI_MODELS=google:x GOOGLE_GENERATIVE_AI_API_KEY=e2e pnpm exec playwright test e2e/pracovni-listy.spec.ts`
 */

/** Hotový list ze `scripts/seed-e2e.ts`. */
const SEED_LIST_ID = 'e2e-pracovni-list'
const SEED_LIST_TITLE = 'E2E pracovní list o fotosyntéze'

test.describe('pracovní listy', () => {
  test('ruční list s fun factem a tabulkou se uloží a vytiskne i s klíčem', async ({ page }) => {
    const nazev = `E2E list o sopkách ${Date.now()}`
    await page.goto('/listy/new')
    await page.getByRole('tab', { name: 'Volné zadání' }).click()
    await page.getByLabel('O čem má list být').fill(nazev)
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

    // Po načtení znovu je všechno na svém místě.
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

  test('list není mezi testy a písemka není mezi listy', async ({ page }) => {
    const pisemka = `E2E písemka mimo listy ${Date.now()}`
    const created = await page.request.post('/api/tests', {
      data: {
        title: pisemka,
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

    await page.goto(`/listy?q=${encodeURIComponent(pisemka)}`)
    await expect(page.getByRole('link', { name: pisemka })).toHaveCount(0)
    await page.goto(`/tests?q=${encodeURIComponent(pisemka)}`)
    await expect(page.getByRole('link', { name: pisemka })).toBeVisible()

    // Detail listu pod trasou písemek přesměruje tam, kam patří.
    await page.goto(`/tests/${SEED_LIST_ID}`)
    await expect(page).toHaveURL(new RegExp(`/listy/${SEED_LIST_ID}$`))
  })

  test('značka ověř se odškrtne kliknutím a upozornění zmizí', async ({ page }) => {
    await page.goto(`/listy/${SEED_LIST_ID}`)
    await expect(page.getByText('Ke kontrole: 1 položka')).toBeVisible()
    await page.getByRole('button', { name: /^ověř — odškrtnout/ }).click()
    await expect(page.getByRole('button', { name: /^ověř — odškrtnout/ })).toHaveCount(0)
    await expect(page.getByText(/Ke kontrole:/)).toHaveCount(0)
  })

  test('bez modelu formulář nabídne jen prázdný list a vysvětlí proč', async ({ page }) => {
    await page.goto('/listy/new')
    const generovat = page.getByRole('button', { name: 'Vygenerovat' })
    test.skip(await generovat.isVisible(), 'Model je v testovacím serveru nastavený.')
    await expect(page.getByText(/Generování listu není nastavené/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Založit prázdný list' })).toBeVisible()
  })

  test('po vygenerování ukáže, kolik položek se vynechalo', async ({ page }) => {
    await page.route('**/api/worksheets/generate', async (route) => {
      await route.fulfill({ json: { id: SEED_LIST_ID, dropped: 2, models: ['google:x'] } })
    })
    await page.goto('/listy/new')
    const generovat = page.getByRole('button', { name: 'Vygenerovat' })
    test.skip(!(await generovat.isVisible()), 'Model není v testovacím serveru nastavený.')

    await page.getByRole('tab', { name: 'Volné zadání' }).click()
    await page.getByLabel('O čem má list být').fill('Fotosyntéza')
    await page.getByLabel('Pokyn pro model (nepovinné)').fill('víc tabulek')
    await generovat.click()

    await expect(page).toHaveURL(new RegExp(`/listy/${SEED_LIST_ID}\\?vynechano=2$`), { timeout: 30_000 })
    await expect(page.getByText('2 položky model nevrátil v pořádku a vynechaly se.', { exact: false })).toBeVisible()
    // S nastaveným modelem jde přegenerovat každý kus.
    await expect(page.getByRole('button', { name: 'Přegenerovat' }).first()).toBeAttached()
  })
})
