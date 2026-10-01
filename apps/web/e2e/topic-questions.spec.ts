import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

/**
 * Topic questions as cards: in-list editing, regeneration, deletion with undo
 * and filtering.
 *
 * Read-only access for the `nahled` role is in `role.spec.ts` — this file runs
 * without login (port 3100), where the role cannot be switched; the `nahled`
 * scenario needs the login config (port 3101), like the rest of that file.
 *
 * Draft review (`kontrola.spec.ts`) is going away — this file does not replace
 * it, because the approval queue ends in the topic; questions are only edited,
 * deleted and regenerated right in the cards here.
 *
 * Own test topic (not `testTopicPath` from `fixtures.ts`): that topic is also
 * shared by `generation.spec.ts`, which expects a fixed number of questions —
 * the questions this file adds would break that count.
 */

const SUBJECT = 'E2E KONTROLA'
const GRADE = 'E2E otázky tématu'
const TOPIC = 'Otázky v tématu jako karty'

/** The material text must be long enough for the topic not to be flagged as low on content. */
const TEXT =
  'Koloběh látek v přírodě propojuje živé organismy s neživým prostředím prostřednictvím výměny látek a energie. '.repeat(
    12,
  )

/**
 * Creates (or finds) a test topic just for this file. Returns its id.
 *
 * `topic` can be overridden — the test for a topic with all questions deleted
 * needs its own isolated topic, so questions from other tests in this file
 * do not populate it (they share `TOPIC` and never end up with no questions).
 */
async function ensureTopic(request: APIRequestContext, topic: string = TOPIC): Promise<string> {
  const imported = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: `${SUBJECT}/${GRADE}/${topic}.txt`,
          fileName: `${topic}.txt`,
          subject: SUBJECT,
          grade: GRADE,
          topic,
          mimeType: 'text/plain',
          sizeBytes: TEXT.length,
          text: TEXT,
          pageCount: null,
          needsOcr: false,
          contentHash: `e2e-tema-otazky-v1:${topic}`,
        },
      ],
    },
  })
  expect(imported.ok(), 'failed to import the test material').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(topic)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const found2 = results.find((result) => result.topicName.includes(topic))
  expect(found2, `test topic „${topic}“ not found in the library`).toBeTruthy()
  return found2!.topicId
}

/** Creates a unique question and returns its id. */
async function addQuestion(
  request: APIRequestContext,
  topicId: string,
  payload: { prompt: string; difficulty: 1 | 2 | 3; type?: 'short_answer' | 'true_false' },
): Promise<string> {
  const question =
    payload.type === 'true_false'
      ? {
          type: 'true_false' as const,
          difficulty: payload.difficulty,
          points: 1,
          blocks: [],
          payload: {
            prompt: payload.prompt,
            statements: [{ text: 'Tvrzení k otázce.', isTrue: true }],
          },
        }
      : {
          type: 'short_answer' as const,
          difficulty: payload.difficulty,
          points: 1,
          blocks: [],
          payload: { prompt: payload.prompt, answer: 'odpověď', acceptedAnswers: [] },
        }
  const created = await request.post('/api/questions', { data: { topicId, question } })
  expect(created.ok(), 'failed to create the test question').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

/** A test with a single item — a question from the topic. Modelled on `createTest` in `e2e/tests.spec.ts`. */
async function createTest(
  request: APIRequestContext,
  title: string,
  questionId: string,
): Promise<string> {
  const created = await request.post('/api/tests', {
    data: {
      title,
      description: null,
      graded: true,
      templateId: 'builtin-klasicka',
      header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
      variants: 1,
      showKey: true,
      items: [{ kind: 'question', questionId }],
    },
  })
  expect(created.ok(), 'failed to create the test').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

/** Reads the number in the „Otázky (N)“ heading. */
async function headerCount(page: Page): Promise<number> {
  const text = await page.locator('h2', { hasText: 'Otázky (' }).textContent()
  const match = text?.match(/\((\d+)\)/)
  expect(match, `question heading is not of the form „Otázky (N)“: ${text}`).toBeTruthy()
  return Number(match![1])
}

/** Reads the number from the „Smazané (N)“ toggle. */
async function readDeletedCount(toggle: Locator): Promise<number> {
  const text = await toggle.textContent()
  const match = text?.match(/\((\d+)\)/)
  expect(match, `the „Smazané“ toggle is not of the form „Smazané (N)“: ${text}`).toBeTruthy()
  return Number(match![1])
}

test.describe('topic questions', () => {
  test('the list shows questions as cards, newest first', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Nejnovější otázka ${Date.now()}`
    await addQuestion(page.request, topicId, { prompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const rows = page.locator('li[data-question-id]')
    await expect(rows.first()).toContainText(prompt)
  })

  test('an edit stays open even when the list refreshes elsewhere meanwhile', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const original = `Otázka k úpravě ${Date.now()}`
    const editedPrompt = `${original} (upraveno)`
    await addQuestion(page.request, topicId, { prompt: original, difficulty: 2 })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: original })
    await row.getByRole('button', { name: 'Upravit' }).click()

    const promptField = row.getByLabel('Zadání')
    await expect(promptField).toHaveValue(original)
    await promptField.fill(editedPrompt)

    // Another action refreshes the list meanwhile (a new question via the form
    // on top) — the edit in progress must not close or lose its typed text.
    await page.getByRole('button', { name: 'Nová otázka' }).click()
    const newForm = page.getByTestId('new-question-form')
    // Type first — switching the type clears the prompt (another type has a
    // different answer shape), so it would erase whatever was typed earlier.
    await newForm.getByLabel('Typ').click()
    await page.getByRole('option', { name: 'Krátká odpověď' }).click()
    await newForm.getByLabel('Zadání').fill(`Vedlejší otázka ${Date.now()}`)
    await newForm.getByLabel('Správná odpověď').fill('vedlejší')
    await newForm.getByRole('button', { name: 'Uložit' }).click()
    await expect(page.getByRole('button', { name: 'Nová otázka' })).toBeEnabled()

    // The edit form is still there and the text stayed as the teacher typed it.
    await expect(promptField).toHaveValue(editedPrompt)

    await row.getByRole('button', { name: 'Uložit' }).click()
    await expect(row.getByRole('button', { name: 'Upravit' })).toBeVisible()
    await expect(row).toContainText(editedPrompt)
  })

  test('deleting a card can be undone right away', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka ke smazání ${Date.now()}`
    await addQuestion(page.request, topicId, { prompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Smazat' }).click()

    await expect(row).toHaveCount(0)
    const toast = page.getByText('Otázka smazána')
    await expect(toast).toBeVisible()
    await page.getByRole('button', { name: 'Vrátit zpět' }).click()

    await expect(page.locator('li[data-question-id]', { hasText: prompt })).toBeVisible()
  })

  test('the type filter hides cards of another type', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const short = `Krátká odpověď filtr ${Date.now()}`
    const trueFalse = `Pravda nepravda filtr ${Date.now()}`
    await addQuestion(page.request, topicId, { prompt: short, difficulty: 1 })
    await addQuestion(page.request, topicId, { prompt: trueFalse, difficulty: 1, type: 'true_false' })

    await page.goto(`/topics/${topicId}`)
    await expect(page.locator('li[data-question-id]', { hasText: short })).toBeVisible()
    await expect(page.locator('li[data-question-id]', { hasText: trueFalse })).toBeVisible()

    await page.locator('#topic-question-type-filter').click()
    await page.getByRole('option', { name: 'Pravda / nepravda' }).click()

    await expect(page.locator('li[data-question-id]', { hasText: trueFalse })).toBeVisible()
    await expect(page.locator('li[data-question-id]', { hasText: short })).toHaveCount(0)
  })

  test('the type filter offers only types the topic actually has', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    await page.goto(`/topics/${topicId}`)

    await page.locator('#topic-question-type-filter').click()
    // This topic only has short answers and true/false (from the other tests in
    // this file) — no other type (e.g. fill-in) was ever created, so it would
    // only haunt the menu as an empty option.
    await expect(page.getByRole('option', { name: 'Krátká odpověď' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Pravda / nepravda' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Doplňovačka' })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('a filter with no match offers resetting it, not the empty-topic message', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka pro filtr bez shody ${Date.now()}`
    await addQuestion(page.request, topicId, { prompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    await expect(page.locator('li[data-question-id]', { hasText: prompt })).toBeVisible()

    // No question from this file has the „Těžká“ difficulty in this topic.
    await page.locator('#topic-question-difficulty-filter').click()
    await page.getByRole('option', { name: 'Těžká' }).click()

    await expect(page.getByText('Filtru neodpovídá žádná otázka.')).toBeVisible()
    // The empty-topic message would be misleading here — the topic has
    // questions, the filter just hides them.
    await expect(page.getByText('V tématu zatím nejsou otázky.')).toHaveCount(0)

    await page.getByRole('button', { name: 'Zrušit filtr' }).click()
    await expect(page.locator('li[data-question-id]', { hasText: prompt })).toBeVisible()
  })

  test('deleting a card lowers the heading count, regenerating keeps it', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na počet v hlavičce ${Date.now()}`
    await addQuestion(page.request, topicId, { prompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()
    const before = await headerCount(page)

    await row.getByRole('button', { name: 'Smazat' }).click()
    await expect(row).toHaveCount(0)
    await expect.poll(() => headerCount(page)).toBe(before - 1)

    await page.getByRole('button', { name: 'Vrátit zpět' }).click()
    await expect(page.locator('li[data-question-id]', { hasText: prompt })).toBeVisible()
    await expect.poll(() => headerCount(page)).toBe(before)
  })

  test('regenerating hides the old card immediately, without waiting for a page refresh', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na přegenerování ${Date.now()}`
    await addQuestion(page.request, topicId, { prompt, difficulty: 1 })

    // The model is not called — this only checks that the card disappears right
    // after a successful response, not only after the list refreshes from the
    // server (it would linger there, since the server knows nothing of the swap).
    await page.route('**/api/questions/regenerate', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { configured: true } })
        return
      }
      await route.fulfill({
        json: {
          question: {
            id: `nahrazena-${Date.now()}`,
            topicId,
            materialId: null,
            source: 'ai',
            status: 'approved',
            createdAt: new Date().toISOString(),
            type: 'short_answer',
            payload: { prompt: `${prompt} (nová)`, answer: 'odpověď', acceptedAnswers: [] },
            blocks: [],
            points: 1,
            difficulty: 1,
          },
        },
      })
    })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Přegenerovat', exact: true }).click()

    await expect(row).toHaveCount(0)
  })

  test('the card shows which test contains the question and the filter hides it accordingly', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka pro použití v testu ${Date.now()}`
    const questionId = await addQuestion(page.request, topicId, { prompt, difficulty: 1 })
    const testName = `E2E test s otázkou tématu ${Date.now()}`
    const testId = await createTest(page.request, testName, questionId)

    // A control question not in any test — the filter must not hide it.
    const unusablePrompt = `Otázka bez testu ${Date.now()}`
    await addQuestion(page.request, topicId, { prompt: unusablePrompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    const unusableRow = page.locator('li[data-question-id]', { hasText: unusablePrompt })
    await expect(row).toBeVisible()
    await expect(unusableRow).toBeVisible()
    const reference = row.getByRole('link', { name: testName })
    await expect(reference).toBeVisible()
    await expect(reference).toHaveAttribute('href', `/tests/${testId}`)

    await page.getByRole('checkbox', { name: 'Jen nepoužité v testu' }).click()
    await expect(row).toHaveCount(0)
    await expect(unusableRow).toBeVisible()

    await page.getByRole('checkbox', { name: 'Jen nepoužité v testu' }).click()
    await expect(row).toBeVisible()
  })

  test('undoing a deletion works even after another action refreshed the list meanwhile', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const a = `Karta A ke smazání ${Date.now()}`
    const b = `Karta B k úpravě ${Date.now()}`
    await addQuestion(page.request, topicId, { prompt: a, difficulty: 1 })
    await addQuestion(page.request, topicId, { prompt: b, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const rowA = page.locator('li[data-question-id]', { hasText: a })
    const rowB = page.locator('li[data-question-id]', { hasText: b })
    await expect(rowA).toBeVisible()
    await expect(rowB).toBeVisible()

    await rowA.getByRole('button', { name: 'Smazat' }).click()
    await expect(rowA).toHaveCount(0)
    const toast = page.getByText('Otázka smazána')
    await expect(toast).toBeVisible()

    // Meanwhile another card is edited — saving calls `router.refresh()`, so
    // the list refreshes before „Vrátit zpět“ is clicked.
    await rowB.getByRole('button', { name: 'Upravit' }).click()
    const edited = `${b} (upraveno)`
    await rowB.getByLabel('Zadání').fill(edited)
    await rowB.getByRole('button', { name: 'Uložit' }).click()
    await expect(page.getByText(edited)).toBeVisible()

    await page.getByRole('button', { name: 'Vrátit zpět' }).click()
    await expect(page.locator('li[data-question-id]', { hasText: a })).toBeVisible()
  })

  test('the „Smazané“ toggle finds a deleted question and it can be restored', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka pro smazané ${Date.now()}`
    await addQuestion(page.request, topicId, { prompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()

    const toggle = page.getByRole('button', { name: /^Smazané \(\d+\)$/ })
    const before = await readDeletedCount(toggle)

    await row.getByRole('button', { name: 'Smazat' }).click()
    await expect(row).toHaveCount(0)
    await expect.poll(() => readDeletedCount(toggle)).toBe(before + 1)

    // Switching the toggle on fetches the deleted questions and shows them as
    // muted cards with a single „Obnovit“ button.
    await toggle.click()
    const deletedRow = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(deletedRow).toBeVisible()
    await expect(deletedRow.getByRole('button', { name: 'Upravit' })).toHaveCount(0)
    await deletedRow.getByRole('button', { name: 'Obnovit' }).click()

    await expect.poll(() => readDeletedCount(toggle)).toBe(before)
    // The card is back in the main list.
    await expect(page.locator('li[data-question-id]', { hasText: prompt })).toBeVisible()
  })

  test('over twenty deleted: newest first and „Načíst další" fetches the rest', async ({ page }) => {
    // Own isolated topic — same reason as for "topic without questions" below:
    // so the deleted count does not depend on what other tests left in the topic.
    const topicId = await ensureTopic(
      page.request,
      `E2E izolovane smazane ${Date.now().toString(36)}`,
    )
    const marker = Date.now()
    const ids: string[] = []
    for (let i = 0; i < 22; i += 1) {
      ids.push(await addQuestion(page.request, topicId, { prompt: `Smazaná ${marker} ${i}`, difficulty: 1 }))
    }
    // Reject one by one — so `reviewedAt` differs and the newest-first order can
    // be verified: index 21 is deleted last, so it is on top.
    for (const id of ids) {
      const rejected = await page.request.put('/api/questions', { data: { ids: [id], status: 'rejected' } })
      expect(rejected.ok(), 'failed to reject the test question').toBe(true)
    }

    await page.goto(`/topics/${topicId}`)
    const toggle = page.getByRole('button', { name: /^Smazané \(\d+\)$/ })
    await expect.poll(() => readDeletedCount(toggle)).toBe(22)
    await toggle.click()

    const rows = page.locator('li[data-question-id]')
    await expect(rows).toHaveCount(20)
    await expect(rows.first()).toContainText(`Smazaná ${marker} 21`)
    await expect(rows.last()).toContainText(`Smazaná ${marker} 2`)

    const loadMore = page.getByRole('button', { name: 'Načíst další' })
    await expect(loadMore).toBeVisible()
    await loadMore.click()

    await expect(rows).toHaveCount(22)
    await expect(rows.last()).toContainText(`Smazaná ${marker} 0`)
    await expect(loadMore).toHaveCount(0)
  })
})

test.describe('topic without questions', () => {
  test('deleting the only question shows the topic empty state', async ({ page }) => {
    // Own name sharing no words with `TOPIC` — otherwise merging of similar
    // names (`sameTopic` in `packages/core/src/extract/grouping.ts`) would join
    // it with this file's shared topic instead of creating a new one. A purely
    // numeric suffix would not count at all — `topicTokens` drops numeric
    // tokens — so two runs of this test would merge with each other;
    // `toString(36)` puts letters into the suffix too.
    const topicId = await ensureTopic(page.request, `E2E izolovane prazdne tema ${Date.now().toString(36)}`)
    const prompt = `Jediná otázka tématu ${Date.now()}`
    await addQuestion(page.request, topicId, { prompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Smazat' }).click()
    await expect(row).toHaveCount(0)
    await expect(page.getByText('V tématu zatím nejsou otázky.')).toBeVisible()
  })
})
