import { expect, test, type Page } from '@playwright/test'

/**
 * The puzzles screen: type words by hand, see the grid in the preview, save
 * and print.
 *
 * The model is never called from here — the tests check that not a single
 * request went to `/api/puzzles/words`. Vocabulary from the model is covered
 * by unit tests with a stubbed call (`apps/web/test/puzzles.test.ts`).
 */

const WORDS: [string, string][] = [
  ['kořen', 'Poutá rostlinu v půdě'],
  ['stonek', 'Nese listy a květy'],
  ['list', 'Probíhá v něm fotosyntéza'],
  ['plod', 'Vzniká z květu'],
]

/**
 * Fills in the title. Typed only after adding words: until the page finishes
 * hydrating, React does not know about the typed text and the saved puzzle
 * would be called "Hlavolam" (it happened reliably in WebKit).
 */
async function typeName(page: Page, name: string): Promise<void> {
  const field = page.getByLabel('Název')
  await field.fill(name)
  await expect(field).toHaveValue(name)
}

/** Types words into the list; each first asks for an empty row. */
async function typeWords(page: Page, words: [string, string][]): Promise<void> {
  for (const [index, [word, hint]] of words.entries()) {
    await page.getByRole('button', { name: 'Přidat slovo' }).click()
    // Exact label: the row's action menu is called "Akce pro slovo 1" and a
    // loose label search would trip over it.
    await page.getByRole('textbox', { name: `Slovo ${index + 1}`, exact: true }).fill(word)
    await page.getByRole('textbox', { name: `Nápověda ${index + 1}`, exact: true }).fill(hint)
  }
}

test.describe('puzzles', () => {
  test('a word search from hand-typed words shows in the preview and saves', async ({ page }) => {
    const modelCalls: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/puzzles/words')) modelCalls.push(request.url())
    })

    const name = `E2E osmisměrka ${Date.now()}`
    await page.goto('/hlavolamy')
    await typeWords(page, WORDS)
    await typeName(page, name)

    // The preview is the paper: the grid must appear right away, without saving.
    const grid = page.locator('[data-slot="puzzle-grid"]')
    await expect(grid).toBeVisible()
    await expect(page.locator('[data-slot="puzzle-words"] li').first()).toHaveText(/KOŘEN/)

    // The given grid size applies: 12 × 12 cells.
    await expect(grid.locator('> div')).toHaveCount(12)
    await expect(grid.locator('> div').first().locator('span')).toHaveCount(12)

    await page.getByRole('button', { name: 'Uložit hlavolam' }).click()
    await expect(page.locator('[data-slot="puzzle-list"]').getByText(name)).toBeVisible()

    expect(modelCalls, 'model se z obrazovky volat nesmí').toEqual([])
  })

  test('a smaller grid reports a word that does not fit', async ({ page }) => {
    await page.goto('/hlavolamy')
    await typeWords(page, [
      ['fotosyntéza', 'Děj v zelených listech'],
      ['list', 'Probíhá v něm fotosyntéza'],
    ])
    await typeName(page, 'E2E malá mřížka')
    await page.getByLabel('Sloupce').fill('6')
    await page.getByLabel('Řádky').fill('6')

    // Silently skipping it would mean the pupil looks for a word that is not in the grid.
    await expect(page.locator('[data-slot="puzzle-problems"]')).toContainText('nevejde')
  })

  test('a cryptogram shows rows and the solution and can be printed', async ({ page }) => {
    const modelCalls: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/puzzles/words')) modelCalls.push(request.url())
    })

    const name = `E2E tajenka ${Date.now()}`
    await page.goto('/hlavolamy')
    await page.getByLabel('Druh hlavolamu').click()
    await page.getByRole('option', { name: 'Tajenka' }).click()
    await typeWords(page, WORDS)
    await typeName(page, name)
    await page.getByLabel('Tajená věta').fill('les')

    // Three phrase letters = three rows with clues. The grid rows themselves
    // are counted (`data-slot="puzzle-row"`), not all direct children of the
    // wrapper — it also has the phrase row and the "Doplňovačka"/"Otázky"
    // labels, which would throw the count off.
    const rows = page.locator('[data-slot="puzzle-row"]')
    await expect(rows).toHaveCount(3)

    // The solution shows what should come out — the empty cells get filled.
    await page.getByText('Ukázat řešení').click()
    await expect(page.locator('[data-slot="puzzle-rows"]')).toContainText('L')

    const print = page.waitForResponse(
      (response) => response.url().includes('/api/puzzles/') && response.url().includes('/pdf'),
    )
    await page.getByRole('button', { name: 'Vytisknout', exact: true }).click()
    expect((await print).status()).toBe(200)

    expect(modelCalls, 'model se z obrazovky volat nesmí').toEqual([])
  })

  test('a broken puzzle saves as a draft, but printing and adding are locked', async ({ page }) => {
    const name = `E2E rozbitá ${Date.now()}`
    await page.goto('/hlavolamy')
    await typeWords(page, [
      ['fotosyntéza', 'Děj v zelených listech'],
      ['list', 'Probíhá v něm fotosyntéza'],
    ])
    await typeName(page, name)
    await page.getByLabel('Sloupce').fill('6')
    await page.getByLabel('Řádky').fill('6')
    await expect(page.locator('[data-slot="puzzle-problems"]')).toContainText('nevejde')

    // Printing and adding are locked and say why.
    await expect(page.getByRole('button', { name: 'Vytisknout', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Vytisknout s řešením' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Zařadit do písemky' })).toBeDisabled()
    await expect(page.locator('[data-slot="puzzle-blocked"]')).toContainText('opravíš potíže')

    // Saving as a draft works, it just says printing is not possible yet.
    await page.getByRole('button', { name: 'Uložit hlavolam' }).click()
    await expect(page.getByText('zatím se nedá vytisknout ani zařadit do písemky')).toBeVisible()
    await expect(page.locator('[data-slot="puzzle-list"]').getByText(name)).toBeVisible()
  })

  test('a word without a clue does not vanish silently and field limits are enforced', async ({ page }) => {
    await page.goto('/hlavolamy')
    await page.getByLabel('Druh hlavolamu').click()
    await page.getByRole('option', { name: 'Tajenka' }).click()
    await typeWords(page, [
      ['kořen', 'Poutá rostlinu v půdě'],
      ['stonek', ''],
      ['list', 'Probíhá v něm fotosyntéza'],
    ])
    await typeName(page, 'E2E bez nápovědy')

    // The row stayed in the list and says what to fill in.
    await expect(page.getByRole('textbox', { name: 'Slovo 2', exact: true })).toHaveValue('stonek')
    const problem = page.locator('[data-slot="puzzle-entry-problem"]')
    await expect(problem).toHaveCount(1)
    await expect(problem).toContainText('Doplň nápovědu')
    await expect(page.locator('[data-slot="puzzle-missing"]')).toContainText('Oprav řádek')

    // A too long word is reported with the actual limit, not a generic message.
    await page.getByRole('textbox', { name: 'Slovo 3', exact: true }).fill('a'.repeat(30))
    await expect(problem.nth(1)).toContainText('nejvýš 24')
  })

  test('the grid size can be retyped and is clamped to the limits', async ({ page }) => {
    await page.goto('/hlavolamy')
    const columns = page.getByLabel('Sloupce')
    await columns.fill('')
    await expect(columns).toHaveValue('')
    await columns.pressSequentially('15')
    await expect(columns).toHaveValue('15')
    await columns.fill('50')
    await columns.blur()
    await expect(columns).toHaveValue('20')
  })

  test('deleting and discarding changes ask first', async ({ page }) => {
    const name = `E2E mazání ${Date.now()}`
    await page.goto('/hlavolamy')
    await typeWords(page, WORDS)
    await typeName(page, name)
    await page.getByRole('button', { name: 'Uložit hlavolam' }).click()
    const row = page.locator('[data-slot="puzzle-list"] li').filter({ hasText: name })
    await expect(row).toBeVisible()

    // An unsaved change: a new puzzle does not discard it without asking.
    await page.getByLabel('Název').fill(`${name} upravený`)
    await page.getByRole('button', { name: 'Nový hlavolam' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Zahodit neuložené změny?')
    await dialog.getByRole('button', { name: 'Nechat být' }).click()
    await expect(page.getByLabel('Název')).toHaveValue(`${name} upravený`)

    // Deleting asks; "Nechat být" keeps the puzzle in the library.
    await row.getByRole('button', { name: /Akce pro hlavolam/ }).click()
    await page.getByRole('menuitem', { name: 'Smazat' }).click()
    await expect(dialog).toContainText(`Smazat hlavolam „${name}"?`)
    await dialog.getByRole('button', { name: 'Nechat být' }).click()
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: /Akce pro hlavolam/ }).click()
    await page.getByRole('menuitem', { name: 'Smazat' }).click()
    await dialog.getByRole('button', { name: 'Smazat hlavolam' }).click()
    // Longer wait: the dev server compiles the DELETE route on the first call.
    await expect(row).toHaveCount(0, { timeout: 20_000 })
  })

  /**
   * Word extraction is tested only where a model is configured (the button is
   * visible) — in a regular test run it is not and the test is skipped. It can
   * be run with a made-up key, e.g.
   * `AI_MODELS=google:x GOOGLE_GENERATIVE_AI_API_KEY=e2e pnpm exec playwright test e2e/puzzles.spec.ts`;
   * the `/api/puzzles/words` response is stubbed anyway, the model is never called.
   */
  test('when the model supplies no words, the UI does not report success', async ({ page }) => {
    await page.route('**/api/puzzles/words**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { entries: [] } })
        return
      }
      await route.fulfill({
        json: { entries: [], rejected: [], models: ['google:x'], requested: 12, returned: 0, dropped: 0 },
      })
    })
    await page.goto('/hlavolamy')
    const extractButton = page.getByRole('button', { name: 'Vytáhnout slova z materiálů' })
    test.skip(!(await extractButton.isVisible()), 'Model není v testovacím serveru nastavený.')

    await page.getByLabel('Téma').click()
    await page.getByRole('option').nth(1).click()
    await extractButton.click()
    await expect(page.getByText('Model nedodal žádné nové slovo.')).toBeVisible()

    // Fewer words than requested is a warning with advice, not a green success.
    await page.unroute('**/api/puzzles/words**')
    await page.route('**/api/puzzles/words**', async (route) => {
      await route.fulfill({
        json: {
          entries: [
            { word: 'kořen', clue: 'Poutá rostlinu v půdě' },
            { word: 'list', clue: 'Zelený orgán' },
          ],
          rejected: [],
          models: ['google:x'],
        },
      })
    })
    await extractButton.click()
    await expect(page.getByText('Přibylo jen 2 slova z 12 požadovaných.')).toBeVisible()
  })
})
