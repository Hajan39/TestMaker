import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * An item on the test page: what can be set for this test only, without
 * changing the question in the bank. Item controls (points, lines, removal)
 * appear at the sheet edge when the item is hovered or focused.
 */

const SUBJECT = 'E2E OSNOVA'
const GRADE = 'E2E osnova testu'

/**
 * An own isolated topic with two short-answer questions — without a nested
 * option list. `[data-slot="paper-sheet"] ol > li` also matches the inner
 * answer `<ol>` (choice options, matching pairs…), so "the first two approved
 * questions from anywhere in the bank" used to be choice types now and then
 * and the item counts on the page went off. Here, instead of DOM order, own
 * data is picked via the bank search filter, so the result does not depend on
 * what other files left in the bank.
 */
async function seedOutlineTopic(request: APIRequestContext): Promise<{ topicId: string; marker: string }> {
  const marker = `Osnova test ${Date.now().toString(36)}`
  const text = `${marker} popisuje vztahy mezi organismy v přírodě. `.repeat(12)
  const imported = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: `${SUBJECT}/${GRADE}/${marker}.txt`,
          fileName: `${marker}.txt`,
          subject: SUBJECT,
          grade: GRADE,
          topic: marker,
          mimeType: 'text/plain',
          sizeBytes: text.length,
          text,
          pageCount: null,
          needsOcr: false,
          contentHash: `e2e-osnova-v1:${marker}`,
        },
      ],
    },
  })
  expect(imported.ok(), 'failed to import the test material').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(marker)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const topic = results.find((result) => result.topicName.includes(marker))
  expect(topic, `test topic "${marker}" not found in the library`).toBeTruthy()
  return { topicId: topic!.topicId, marker }
}

/** A short-answer question — on paper without a nested option list. */
async function seedShortAnswer(request: APIRequestContext, topicId: string, prompt: string): Promise<void> {
  const created = await request.post('/api/questions', {
    data: {
      topicId,
      question: {
        type: 'short_answer',
        difficulty: 1,
        points: 1,
        blocks: [],
        payload: { prompt, answer: 'odpověď', acceptedAnswers: [] },
      },
    },
  })
  expect(created.ok(), 'failed to create the test question').toBe(true)
}
test.describe('outline item', () => {
  test('a free answer allows setting the line count and it is saved with the test', async ({ page }) => {
    await page.goto('/tests/new')

    // Free answer is the only type where a line count makes sense. The search is
    // not limited to the first group — group order depends on the database and
    // the first one may not contain a free answer at all.
    const groups = page.locator('details')
    let openQuestion = groups.first()
    for (let i = 0; i < (await groups.count()); i++) {
      const group = groups.nth(i)
      await group.locator('summary').click()
      const candidate = group.locator('> ul > li').filter({ hasText: 'Volná odpověď' }).first()
      if ((await candidate.count()) > 0) {
        openQuestion = candidate
        break
      }
      await group.locator('summary').click()
    }
    await openQuestion.getByRole('checkbox').click()

    const lines = page.getByLabel('Řádků na odpověď')
    await expect(lines).toBeVisible()
    await lines.fill('9')

    // The title is right in the builder header.
    await page.getByLabel('Název písemky').fill('Zkouška počtu řádků')
    await page.getByRole('button', { name: 'Uložit' }).click()
    // After saving the URL changes to the test detail (careful: "/tests/new"
    // would match a generic pattern too).
    await page.waitForURL((url) => /\/tests\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'))

    // Load the saved test again from the URL (not `reload`: after a client-side
    // redirect a reload still goes to /tests/new).
    await page.goto(page.url())
    await expect(page.getByLabel('Řádků na odpověď')).toHaveValue('9')
  })
})

/**
 * Composing a test: where a new item can be inserted on the page and whether
 * the same question may be added more than once.
 */
test.describe('composing the outline', () => {
  /**
   * Adds two own questions to an empty outline so the result does not depend
   * on what other files put first in the bank — the bank search filter narrows
   * the groups to the single own one. The topic's third question stays
   * unselected: "Vybrat vše" then has something to add without unticking these two.
   */
  async function addTwoQuestions(page: Page) {
    const { topicId, marker } = await seedOutlineTopic(page.request)
    await seedShortAnswer(page.request, topicId, `${marker}: první otázka`)
    await seedShortAnswer(page.request, topicId, `${marker}: druhá otázka`)
    await seedShortAnswer(page.request, topicId, `${marker}: třetí otázka`)

    await page.goto('/tests/new')
    // Repeated filling (`toPass`): in WebKit the first letters can land in the
    // field before the page hydrates, and the bank filter then has no effect —
    // the same safeguard as `search` in tests.spec.ts.
    const search = page.getByLabel('Hledat')
    const group = page.locator('details')
    await expect(async () => {
      await search.fill('')
      await search.fill(marker)
      await expect(group).toHaveCount(1, { timeout: 2000 })
    }).toPass({ timeout: 20_000 })

    await group.locator('summary').click()

    const questions = page.locator('details[open] > ul > li')
    await expect(questions).toHaveCount(3)
    await questions.nth(0).getByRole('checkbox').click()
    await questions.nth(1).getByRole('checkbox').click()
    return questions
  }

  test('a section heading can be inserted before the first item, not only at the end', async ({ page }) => {
    await addTwoQuestions(page)

    // Items across all sheets: the page breaks where the PDF breaks.
    const rows = page.locator('[data-slot="paper-sheet"] ol > li')
    // Interleaved insert bars: 2 questions = 3 insert slots + 2 rows.
    await expect(rows).toHaveCount(5)

    await page.getByLabel('Vložit před 1. položku').click()
    await page.getByRole('menuitem', { name: 'Nadpis části' }).click()

    // The heading really is the first item of the page, not the last. On paper it
    // is a section heading directly, not a row with a badge — found by its field label.
    await expect(rows.nth(1).getByLabel('Nadpis části')).toHaveValue('Nová část')
    await expect(rows).toHaveCount(7)

    // And an instruction inserted in the middle ends up between both questions.
    await page.getByLabel('Vložit před 3. položku').click()
    await page.getByRole('menuitem', { name: 'Pokyn' }).click()
    await expect(rows.nth(5).getByLabel('Pokyn k vypracování')).toBeVisible()
  })

  test('the insert button works with the keyboard too', async ({ page }) => {
    await addTwoQuestions(page)

    const insert = page.getByLabel('Vložit na konec')
    await insert.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: 'Zalomení strany' }).click()

    // The last <li> is the insert bar at the end, the item is second to last.
    // A page break shows on the page as a "nová strana" divider.
    const rows = page.locator('[data-slot="paper-sheet"] ol > li')
    await expect(rows.nth((await rows.count()) - 2)).toContainText('nová strana')
  })

  test('the same question can be added twice and is saved twice', async ({ page }) => {
    const questions = await addTwoQuestions(page)
    const first = questions.first()
    await expect(first.getByTestId('question-used-count')).toHaveAttribute('data-count', '1')

    // "Vybrat vše" adds only the missing ones — it must not duplicate already added questions.
    await page.getByRole('checkbox', { name: 'Vybrat vše', exact: true }).click()
    await expect(first.getByTestId('question-used-count')).toHaveAttribute('data-count', '1')

    // A question already in the test offers adding another occurrence at the end.
    await first.getByRole('button', { name: 'Zařadit do testu ještě jednou' }).click()
    await expect(first.getByTestId('question-used-count')).toHaveAttribute('data-count', '2')
    const count = await page.getByTestId('test-question-count').first().getAttribute('data-count')

    await page.getByLabel('Název písemky').fill('Zkouška dvojího použití')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await page.waitForURL((url) => /\/tests\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'))

    // After reloading both occurrences must survive including order — the second
    // stays at the end of the outline where it was added.
    await page.goto(page.url())
    await expect(page.getByTestId('test-question-count').first()).toHaveAttribute('data-count', count ?? '')
    const rows = page.locator('[data-slot="paper-sheet"] ol > li')
    await expect(rows.nth(1)).toContainText('1. použití')
    // Second-to-last <li>: an insert bar follows the last item.
    await expect(rows.nth((await rows.count()) - 2)).toContainText('2. použití')
  })
})
