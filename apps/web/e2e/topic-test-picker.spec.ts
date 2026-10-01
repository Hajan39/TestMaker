import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Checking questions in a topic and creating a test from the selection. The
 * bottom bar shows the count and points, and "Vytvořit test" creates a new
 * test straight from the selected questions.
 *
 * Own test topic (the `ensureTopic` pattern from `topic-questions.spec.ts`) —
 * not shared with other files, so the card count does not depend on what was
 * left over from another run.
 */

const SUBJECT = 'E2E VYBER'
const GRADE = 'E2E výběr do testu'
const TOPIC = 'Výběr otázek do testu'

const TEXT =
  'Koloběh látek v přírodě propojuje živé organismy s neživým prostředím prostřednictvím výměny látek a energie. '.repeat(
    12,
  )

async function ensureTopic(
  request: APIRequestContext,
  topic: string = TOPIC,
  grade: string = GRADE,
): Promise<string> {
  const imported = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: `${SUBJECT}/${grade}/${topic}.txt`,
          fileName: `${topic}.txt`,
          subject: SUBJECT,
          grade,
          topic,
          mimeType: 'text/plain',
          sizeBytes: TEXT.length,
          text: TEXT,
          pageCount: null,
          needsOcr: false,
          contentHash: `e2e-tema-vyber-v1:${topic}`,
        },
      ],
    },
  })
  expect(imported.ok(), 'could not import the test material').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(topic)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const match = results.find((result) => result.topicName.includes(topic))
  expect(match, `test topic "${topic}" not found in the library`).toBeTruthy()
  return match!.topicId
}

async function addQuestion(
  request: APIRequestContext,
  topicId: string,
  prompt: string,
  points = 1,
): Promise<string> {
  const created = await request.post('/api/questions', {
    data: {
      topicId,
      question: {
        type: 'short_answer',
        difficulty: 1,
        points,
        blocks: [],
        payload: { prompt, answer: 'odpověď', acceptedAnswers: [] },
      },
    },
  })
  expect(created.ok(), 'could not create the test question').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

test.describe('picking questions for a test', () => {
  test('checking shows the bar, deleting a selected one shrinks it, creating a test makes one', async ({
    page,
  }) => {
    const topicId = await ensureTopic(page.request)
    const a = `Výběr karta A ${Date.now()}`
    const b = `Výběr karta B ${Date.now()}`
    const c = `Výběr karta C ${Date.now()}`
    await addQuestion(page.request, topicId, a, 2)
    await addQuestion(page.request, topicId, b, 3)
    await addQuestion(page.request, topicId, c, 1)

    await page.goto(`/topics/${topicId}`)
    const rowA = page.locator('li[data-question-id]', { hasText: a })
    const rowB = page.locator('li[data-question-id]', { hasText: b })
    const rowC = page.locator('li[data-question-id]', { hasText: c })
    await expect(rowA).toBeVisible()
    await expect(rowB).toBeVisible()
    await expect(rowC).toBeVisible()

    // The bar is not visible yet — nothing is selected.
    await expect(page.getByText(/^Vybráno/)).toHaveCount(0)

    await rowA.getByRole('checkbox', { name: 'Vybrat do testu' }).click()
    await rowB.getByRole('checkbox', { name: 'Vybrat do testu' }).click()
    await expect(page.getByText('Vybráno 2 · 5 bodů')).toBeVisible()

    // Deleting a selected card removes it from the selection and the point total.
    await rowB.getByRole('button', { name: 'Smazat' }).click()
    await expect(rowB).toHaveCount(0)
    await expect(page.getByText('Vybráno 1 · 2 body')).toBeVisible()

    await rowC.getByRole('checkbox', { name: 'Vybrat do testu' }).click()
    await expect(page.getByText('Vybráno 2 · 3 body')).toBeVisible()

    await page.getByRole('button', { name: 'Vytvořit test' }).click()
    await page.waitForURL((url) => /\/tests\/[^/]+/.test(url.pathname))
    await expect(page).toHaveURL(new RegExp(`tema=${topicId}`))

    // Regression test: `router.refresh()` must run before `router.push()`
    // (`TopicQuestions.createTestFromSelection`) — otherwise the topic page stays
    // in history with the old state (without the "V testu" badge) and going
    // back shows it stale.
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/topics/${topicId}$`))
    await expect(rowA.getByText(/^V testu:/)).toBeVisible()
    await page.goForward()
    await page.waitForURL((url) => /\/tests\/[^/]+/.test(url.pathname))

    // The outline has both questions in the order they stood in the topic list
    // from the top — newest first, so C (added last) is above A.
    const rows = page.locator('[data-slot="paper-sheet"] ol > li')
    await expect(rows.filter({ hasText: a })).toHaveCount(1)
    await expect(rows.filter({ hasText: c })).toHaveCount(1)
    const indexA = await rows.filter({ hasText: a }).first().evaluate((el) => Array.from(el.parentElement!.children).indexOf(el))
    const indexC = await rows.filter({ hasText: c }).first().evaluate((el) => Array.from(el.parentElement!.children).indexOf(el))
    expect(indexC).toBeLessThan(indexA)

    // Test name = topic name.
    await expect(page.getByLabel('Název písemky')).toHaveValue(/Výběr otázek do testu/)

    // The header shows the class the test came from and a link back to the topic.
    const backLink = page.getByRole('link', { name: /Zpět do tématu/ })
    await expect(backLink).toBeVisible()
    await expect(backLink).toHaveAttribute('href', `/topics/${topicId}`)
    await expect(backLink.locator('..')).toContainText(`${SUBJECT} · ${GRADE}`)

    // A second topic in another grade — with the default filter (the test's class)
    // the bank shows only the own class's topic; after switching to "Všechny třídy"
    // the other one too. Grade and topic names carry a timestamp — otherwise
    // grouping of similar topics would merge the new one into an old one from an earlier run.
    const otherGrade = `${GRADE} jiná třída ${Date.now()}`
    const otherTopic = `${TOPIC} jinde ${Date.now()}`
    const otherTopicId = await ensureTopic(page.request, otherTopic, otherGrade)
    const otherPrompt = `Otázka z jiné třídy ${Date.now()}`
    await addQuestion(page.request, otherTopicId, otherPrompt, 1)
    await page.reload()

    const bankOwnGrade = page.getByText(new RegExp(`${SUBJECT} · ${otherGrade} · `))
    await expect(bankOwnGrade).toHaveCount(0)

    await page.getByLabel('Ročník').click()
    await page.getByRole('option', { name: 'Všechny třídy' }).click()
    await expect(bankOwnGrade).toBeVisible()

    // The question from the other class is added to the outline via the bank and
    // the test is saved — the first save must not clear the test's class (critical
    // fix: a missing `gradeId` in the request body used to mean "remove the class").
    await bankOwnGrade.click() // expands the topic's <details>, otherwise the question is hidden
    const bankRow = page.locator('li', { hasText: otherPrompt })
    await bankRow.getByRole('checkbox').first().click()
    await expect(page.locator('[data-slot="paper-sheet"]').getByText(otherPrompt)).toBeVisible()

    const saveResponse = page.waitForResponse(
      (candidate) => candidate.url().includes('/api/tests') && candidate.request().method() === 'PUT',
    )
    await page.getByRole('button', { name: 'Uložit' }).click()
    expect((await saveResponse).ok()).toBe(true)

    await page.reload()

    // The header still shows the class and the outline has questions from both topics.
    await expect(backLink.locator('..')).toContainText(`${SUBJECT} · ${GRADE}`)
    const rowsAfterSave = page.locator('[data-slot="paper-sheet"] ol > li')
    await expect(rowsAfterSave.filter({ hasText: a })).toHaveCount(1)
    await expect(rowsAfterSave.filter({ hasText: otherPrompt })).toHaveCount(1)

    // The print menu responds — the PDF content is not checked here, only that it is generated.
    await page.getByRole('button', { name: 'Tisk a PDF' }).click()
    const pdfResponse = page.waitForResponse((candidate) => candidate.url().includes('/pdf'))
    await page.getByRole('menuitem', { name: 'Stáhnout zadání pro žáky' }).click()
    expect((await pdfResponse).ok()).toBe(true)
  })

  test('a test class without questions in the bank offers all classes instead of an empty filter', async ({
    page,
  }) => {
    // The test's own class ends up with no question in the bank (the only one is
    // rejected right after the test is created) — the Select must not get stuck
    // on a class that is not in the options at all, nor may the bank be empty
    // while another class has questions.
    const gradeSelf = `${GRADE} bez otázek ${Date.now()}`
    const topicSelf = `${TOPIC} bez otázek ${Date.now()}`
    const topicIdSelf = await ensureTopic(page.request, topicSelf, gradeSelf)
    const promptSelf = `Otázka co zmizí z banky ${Date.now()}`
    const questionIdSelf = await addQuestion(page.request, topicIdSelf, promptSelf, 1)

    const gradeOther = `${GRADE} zůstane v bance ${Date.now()}`
    const topicOther = `${TOPIC} zůstane v bance ${Date.now()}`
    const topicIdOther = await ensureTopic(page.request, topicOther, gradeOther)
    const promptOther = `Otázka, co v bance zůstane ${Date.now()}`
    await addQuestion(page.request, topicIdOther, promptOther, 1)

    await page.goto(`/topics/${topicIdSelf}`)
    const rowSelf = page.locator('li[data-question-id]', { hasText: promptSelf })
    await rowSelf.getByRole('checkbox', { name: 'Vybrat do testu' }).click()
    await page.getByRole('button', { name: 'Vytvořit test' }).click()
    await page.waitForURL((url) => /\/tests\/[^/]+/.test(url.pathname))

    // Rejecting removes the question from the bank — exactly the "class without questions" scenario.
    const rejected = await page.request.put('/api/questions', {
      data: { ids: [questionIdSelf], status: 'rejected' },
    })
    expect(rejected.ok()).toBe(true)

    await page.reload()

    // The trigger shows "Všechny třídy", not blank and not a class missing from
    // the options. `getByLabel` would be ambiguous here — the library has other
    // topics whose checkbox "Vybrat všechny otázky tématu … ročník …" contains
    // the same name as a substring.
    await expect(page.getByRole('combobox', { name: 'Ročník' })).toHaveText('Všechny třídy')

    // The other class's topic is visible in the bank right away (no manual filter
    // switch), just collapsed like any other — expanding it shows its question.
    const bankOtherGrade = page.getByText(new RegExp(`${SUBJECT} · ${gradeOther} · `))
    await expect(bankOtherGrade).toBeVisible()
    await bankOtherGrade.click()
    await expect(page.getByText(promptOther)).toBeVisible()
  })

  test('"Zrušit výběr" hides the bar', async ({ page }) => {
    const topicId = await ensureTopic(page.request, `${TOPIC} zrušení`)
    const prompt = `Výběr ke zrušení ${Date.now()}`
    await addQuestion(page.request, topicId, prompt, 1)

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await row.getByRole('checkbox', { name: 'Vybrat do testu' }).click()
    await expect(page.getByText('Vybráno 1 · 1 bod')).toBeVisible()

    await page.getByRole('button', { name: 'Zrušit výběr' }).click()
    await expect(page.getByText(/^Vybráno/)).toHaveCount(0)
  })
})
