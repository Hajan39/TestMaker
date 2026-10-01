import { expect, test, type Page } from '@playwright/test'

/**
 * The test page in the builder: preview and test content in one surface. A
 * question renders there as it will print, can be moved and removed there, and
 * pages break where the PDF breaks them.
 *
 * Uses the seeded topic "Měkkýši" (see `scripts/seed-e2e.ts`) — it has
 * questions of all common types and can be filtered in the bank by search.
 */

const TOPIC = 'Měkkýši'

/** Opens an empty builder, filters the topic and ticks the first `count` questions. */
async function addQuestions(page: Page, count: number) {
  await page.goto('/tests/new')

  // Filling the search repeats until the page keeps it: in Safari it can arrive
  // before hydration and React then resets it to empty.
  const search = page.getByLabel('Hledat')
  await expect
    .poll(async () => {
      await search.fill(TOPIC)
      return search.inputValue()
    }, { message: 'the bank search was not filled in' })
    .toBe(TOPIC)

  const topic = page.locator('details').filter({ hasText: TOPIC }).first()
  await topic.locator('summary').click()
  const questions = topic.locator('> ul > li')
  await expect(questions).toHaveCount(4)
  for (let i = 0; i < count; i += 1) {
    await questions.nth(i).getByRole('checkbox').click()
  }
  return questions
}

const sheets = (page: Page) => page.locator('[data-slot="paper-sheet"]')

test.describe('test page', () => {
  test('an added question appears on the sheet in print form', async ({ page }) => {
    await addQuestions(page, 3)

    const list = sheets(page).first()
    await expect(list).toBeVisible()

    // The test header prints on the first page: lines to fill in and a box for points.
    await expect(list.getByText('Jméno a příjmení:')).toBeVisible()
    await expect(list.getByText(/Body: ______/)).toBeVisible()

    // Single choice: question number, prompt and lettered options.
    const selection = list.getByRole('listitem').filter({ hasText: 'která odpověď je správná' }).first()
    await expect(selection).toContainText('1.')
    await expect(selection).toContainText('A)')
    await expect(selection).toContainText('B)')
    await expect(selection).toContainText('Druhá možnost')

    // True/false is a table with ANO and NE columns.
    await expect(list.getByRole('table')).toContainText('ANO')
    await expect(list.getByRole('table')).toContainText('NE')

    // A free answer has real writing lines (four by default).
    await expect(list.locator('[data-slot="paper-line"]')).toHaveCount(4)

    // The key is not drawn on paper: the model answer is not on the sheet.
    await expect(list.getByText('Odpověď vlastními slovy.')).toHaveCount(0)
  })

  test('the model answer shows only via the Řešení button and is marked as not printed', async ({ page }) => {
    await addQuestions(page, 3)

    // Only items on the sheet — the same question is also visible in the bank on the left.
    const free = page
      .locator('[data-slot="paper-sheet"] ol > li')
      .filter({ hasText: 'vysvětli vlastními slovy' })
      .first()
    await free.hover()
    await free.getByRole('button', { name: 'Řešení' }).click()

    const solution = page.locator('[data-slot="reseni"]')
    await expect(solution).toBeVisible()
    await expect(solution).toContainText('Vzorová odpověď (netiskne se)')
    await expect(solution).toContainText('Odpověď vlastními slovy.')

    // A second click hides it again — it does not belong on paper.
    await free.getByRole('button', { name: 'Řešení' }).click()
    await expect(solution).toHaveCount(0)
  })

  test('an item can be dragged with the keyboard and removed', async ({ page }) => {
    await addQuestions(page, 2)

    const rows = page.locator('[data-slot="paper-sheet"] ol > li')
    /** Question prompts in the order they appear on the sheet. */
    const order = async () => {
      const texts = await rows.allInnerTexts()
      return texts.filter((t) => t.includes('Měkkýši:')).map((t) => t.split('\n')[0])
    }

    const before = await order()
    expect(before).toHaveLength(2)

    // Keyboard drag: space grabs the handle, arrow moves, space drops.
    const handle = rows
      .filter({ hasText: before[0]! })
      .first()
      .getByRole('button', { name: 'Přetáhnout pro změnu pořadí' })
    await handle.focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')

    await expect.poll(order, { message: 'the order did not change' }).toEqual([before[1], before[0]])

    // Removal disappears from the sheet and from the summary below it.
    const summary = page.locator('dl').filter({ hasText: 'Odhad stran:' })
    await expect(summary).toContainText('Otázek: 2')
    const first = rows.filter({ hasText: before[1]! }).first()
    await first.hover()
    await first.getByRole('button', { name: 'Odebrat' }).click()
    await expect(summary).toContainText('Otázek: 1')
    await expect.poll(order).toEqual([before[0]])
  })

  test('the page count on screen matches the page count of the downloaded PDF', async ({ page, request }) => {
    await addQuestions(page, 2)

    // One sheet until the test breaks.
    await expect(sheets(page)).toHaveCount(1)

    // A page break between questions makes a second page.
    await page.getByLabel('Vložit před 2. položku').click()
    await page.getByRole('menuitem', { name: 'Zalomení strany' }).click()
    await expect(sheets(page)).toHaveCount(2)
    await expect(page.locator('dl').filter({ hasText: 'Odhad stran:' })).toContainText('Odhad stran: 2')

    await page.getByLabel('Název písemky').fill('Zkouška počtu stran')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await page.waitForURL((url) => /\/tests\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'))
    const testId = new URL(page.url()).pathname.split('/').pop()!

    // The pupils' assignment (without key) — that is what the page shows.
    const pdf = await request.get(`/api/tests/${testId}/pdf?variant=A`)
    expect(pdf.ok(), 'failed to download the PDF').toBe(true)
    const body = (await pdf.body()).toString('latin1')
    const pages = (body.match(/\/Type\s*\/Page[^s]/g) ?? []).length

    const onScreen = await sheets(page).count()
    expect(pages, 'the PDF has a different page count than the builder page').toBe(onScreen)

    await request.delete(`/api/tests?id=${testId}`)
  })
})
