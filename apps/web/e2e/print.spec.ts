import { expect, test, type Page } from '@playwright/test'

/**
 * Printing must not hand the solutions out to pupils.
 *
 * "Přiložit klíč" used to be on by default for a test and the builder's
 * "Vytisknout" button attached the key based on it, while the button of the same
 * name in the test list never attached it. Now there are two actions — "zadání
 * pro žáky" and "vyplněná pro mě" — and they must behave the same in both places.
 *
 * What the server actually sent is told by the file name in the
 * `content-disposition` header (see `src/app/api/tests/[id]/pdf/route.ts`): the
 * filled-in copy gets "vyplněná" in the name.
 */

const TITLE = 'Zkouška tisku klíče'

/** File name from the `content-disposition` header in the form `filename*=UTF-8''…`. */
function fileName(header: string | undefined): string {
  const match = /filename\*=UTF-8''([^;]+)/i.exec(header ?? '')
  expect(match, `content-disposition header carries no file name: ${header}`).not.toBeNull()
  return decodeURIComponent(match![1]!)
}

/** Clicks a menu item and returns the file name the server sent. */
async function fileNameAfterClick(page: Page, testId: string, item: string): Promise<string> {
  const response = page.waitForResponse(
    (candidate) => candidate.url().includes(`/api/tests/${testId}/pdf`),
    { timeout: 30_000 },
  )
  await page.getByRole('menuitem', { name: item }).click()
  return fileName((await response).headers()['content-disposition'])
}

test.describe('printing the assignment and the key', () => {
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
    expect(created.ok(), 'failed to create the test fixture').toBe(true)
    testId = ((await created.json()) as { id: string }).id
  })

  test.afterEach(async ({ page }) => {
    await page.request.delete(`/api/tests?id=${encodeURIComponent(testId)}`)
  })

  test('builder: the assignment has no key, the teacher copy is filled in', async ({ page }) => {
    await page.goto(`/tests/${testId}`)

    await page.getByRole('button', { name: 'Tisk a PDF' }).click()
    const assignment = await fileNameAfterClick(page, testId, 'Stáhnout zadání pro žáky')
    expect(assignment).toBe(`${TITLE} A.pdf`)

    await page.getByRole('button', { name: 'Tisk a PDF' }).click()
    const key = await fileNameAfterClick(page, testId, 'Stáhnout vyplněnou pro mě')
    expect(key).toBe(`${TITLE} A vyplněná.pdf`)
  })

  test('test list: the same actions give the same result', async ({ page }) => {
    await page.goto('/tests')
    const row = page.getByRole('row').filter({ hasText: TITLE })
    await expect(row).toHaveCount(1)

    await row.getByRole('button', { name: 'Akce' }).click()
    const assignment = await fileNameAfterClick(page, testId, 'Stáhnout zadání pro žáky')
    expect(assignment).toBe(`${TITLE} A.pdf`)

    // The menu closes after the click and a spinner shows in place of the button for a while.
    await expect(row.getByRole('button', { name: 'Akce' })).toBeVisible({ timeout: 30_000 })
    await row.getByRole('button', { name: 'Akce' }).click()
    const key = await fileNameAfterClick(page, testId, 'Stáhnout vyplněnou pro mě')
    expect(key).toBe(`${TITLE} A vyplněná.pdf`)
  })

  test('printing the assignment sends a PDF without the key to the printer', async ({ page }) => {
    await page.goto(`/tests/${testId}`)
    await page.getByRole('button', { name: 'Tisk a PDF' }).click()
    const printed = await fileNameAfterClick(page, testId, 'Vytisknout zadání pro žáky')
    expect(printed).toBe(`${TITLE} A.pdf`)
  })
})
