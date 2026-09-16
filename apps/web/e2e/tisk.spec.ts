import { expect, test, type Page } from '@playwright/test'

/**
 * Tisk nesmí rozdat dětem řešení.
 *
 * Dřív bylo „Přiložit klíč" u testu ve výchozím stavu zapnuté a tlačítko
 * „Vytisknout" ve skladači podle něj přikládalo klíč, zatímco stejně pojmenované
 * tlačítko v seznamu testů ho nepřikládalo nikdy. Teď jsou akce dvě — „zadání
 * pro žáky" a „klíč pro mě" — a musí se chovat stejně na obou místech.
 *
 * Co vlastně přišlo ze serveru, se pozná podle názvu souboru v hlavičce
 * `content-disposition` (viz `src/app/api/tests/[id]/pdf/route.ts`): klíč se
 * do názvu připisuje jako „+ klíč".
 */

const TITLE = 'Zkouška tisku klíče'

/** Název souboru z hlavičky `content-disposition` ve tvaru `filename*=UTF-8''…`. */
function fileName(header: string | undefined): string {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')
  expect(match, `hlavička content-disposition nenese název souboru: ${header}`).not.toBeNull()
  return decodeURIComponent(match![1]!)
}

/** Klikne na položku nabídky a vrátí název souboru, který server poslal. */
async function fileNameAfterClick(page: Page, testId: string, item: string): Promise<string> {
  const response = page.waitForResponse(
    (candidate) => candidate.url().includes(`/api/tests/${testId}/pdf`),
    { timeout: 30_000 },
  )
  await page.getByRole('menuitem', { name: item }).click()
  return fileName((await response).headers()['content-disposition'])
}

test.describe('tisk zadání a klíče', () => {
  let testId: string

  test.beforeEach(async ({ page }) => {
    const created = await page.request.post('/api/tests', {
      data: {
        title: TITLE,
        description: null,
        graded: true,
        templateId: 'builtin-klasicka',
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        variants: 1,
        items: [{ kind: 'heading', questionId: null, text: 'Část A', pointsOverride: null }],
      },
    })
    expect(created.ok(), 'zkušební test se nepodařilo založit').toBe(true)
    testId = ((await created.json()) as { id: string }).id
  })

  test.afterEach(async ({ page }) => {
    await page.request.delete(`/api/tests?id=${encodeURIComponent(testId)}`)
  })

  test('skladač: zadání je bez klíče, klíč s klíčem', async ({ page }) => {
    await page.goto(`/tests/${testId}`)

    await page.getByRole('button', { name: 'Tisk a PDF' }).click()
    const zadani = await fileNameAfterClick(page, testId, 'Stáhnout zadání pro žáky')
    expect(zadani).toBe(`${TITLE} A.pdf`)

    await page.getByRole('button', { name: 'Tisk a PDF' }).click()
    const klic = await fileNameAfterClick(page, testId, 'Stáhnout klíč pro mě')
    expect(klic).toBe(`${TITLE} A + klíč.pdf`)
  })

  test('seznam testů: tytéž akce dávají totéž', async ({ page }) => {
    await page.goto('/tests')
    const row = page.getByRole('row').filter({ hasText: TITLE })
    await expect(row).toHaveCount(1)

    await row.getByRole('button', { name: 'Akce' }).click()
    const zadani = await fileNameAfterClick(page, testId, 'Stáhnout zadání pro žáky')
    expect(zadani).toBe(`${TITLE} A.pdf`)

    // Nabídka se po kliknutí zavře a na místě tlačítka chvíli svítí čekání.
    await expect(row.getByRole('button', { name: 'Akce' })).toBeVisible({ timeout: 30_000 })
    await row.getByRole('button', { name: 'Akce' }).click()
    const klic = await fileNameAfterClick(page, testId, 'Stáhnout klíč pro mě')
    expect(klic).toBe(`${TITLE} A + klíč.pdf`)
  })

  test('tisk zadání posílá do tiskárny PDF bez klíče', async ({ page }) => {
    await page.goto(`/tests/${testId}`)
    await page.getByRole('button', { name: 'Tisk a PDF' }).click()
    const vytisteno = await fileNameAfterClick(page, testId, 'Vytisknout zadání pro žáky')
    expect(vytisteno).toBe(`${TITLE} A.pdf`)
  })
})
