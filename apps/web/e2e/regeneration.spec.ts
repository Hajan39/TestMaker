import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Regenerating a question with a reason: a split button on the question card —
 * the main part regenerates right away (unchanged behaviour), the arrow opens
 * a menu of seven reasons with an optional note.
 *
 * The model is not called — the `/api/questions/regenerate` response is faked
 * (`page.route`), just like in "regenerating hides the old card immediately"
 * in `topic-questions.spec.ts`. Only the request body the UI sends is checked.
 */

const SUBJECT = 'E2E KONTROLA'
const GRADE = 'E2E přegenerování s důvodem'
const TOPIC = 'Přegenerování s důvodem'

/** The material text must be long enough for the topic not to be flagged as low on content. */
const TEXT =
  'Vodní koloběh přesouvá vodu mezi oceánem, atmosférou a pevninou skrz vypařování, srážky a odtok. '.repeat(12)

async function ensureTopic(request: APIRequestContext): Promise<string> {
  const imported = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: `${SUBJECT}/${GRADE}/${TOPIC}.txt`,
          fileName: `${TOPIC}.txt`,
          subject: SUBJECT,
          grade: GRADE,
          topic: TOPIC,
          mimeType: 'text/plain',
          sizeBytes: TEXT.length,
          text: TEXT,
          pageCount: null,
          needsOcr: false,
          contentHash: 'e2e-pregenerovani-v1',
        },
      ],
    },
  })
  expect(imported.ok(), 'failed to import the test material').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const found2 = results.find((result) => result.topicName.includes(TOPIC))
  expect(found2, `test topic „${TOPIC}“ not found in the library`).toBeTruthy()
  return found2!.topicId
}

async function addQuestion(request: APIRequestContext, topicId: string, prompt: string): Promise<string> {
  const created = await request.post('/api/questions', {
    data: {
      topicId,
      question: {
        type: 'short_answer',
        difficulty: 2,
        points: 1,
        blocks: [],
        payload: { prompt, answer: 'odpověď', acceptedAnswers: [] },
      },
    },
  })
  expect(created.ok(), 'failed to create the test question').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

/** Fakes a successful regenerate response and returns the requests that arrived via POST. */
async function mockRegenerate(page: Page, topicId: string, prompt: string): Promise<Record<string, unknown>[]> {
  const requests: Record<string, unknown>[] = []
  await page.route('**/api/questions/regenerate', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { configured: true } })
      return
    }
    requests.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({
      json: {
        question: {
          id: `nahrazena-${requests.length}-${Date.now()}`,
          topicId,
          materialId: null,
          source: 'ai',
          status: 'approved',
          createdAt: new Date().toISOString(),
          type: 'short_answer',
          payload: { prompt: `${prompt} (nová)`, answer: 'odpověď', acceptedAnswers: [] },
          blocks: [],
          points: 1,
          difficulty: 2,
        },
      },
    })
  })
  return requests
}

test.describe('regenerating with a reason', () => {
  test('the main button regenerates right away, behaviour unchanged', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na hlavní tlačítko ${Date.now()}`
    await addQuestion(page.request, topicId, prompt)
    const requests = await mockRegenerate(page, topicId, prompt)

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Přegenerovat', exact: true }).click()

    await expect(row).toHaveCount(0)
    await expect(page.getByText('Otázka nahrazena novou.')).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(requests[0]).not.toHaveProperty('reason')
    expect(requests[0]).not.toHaveProperty('note')
  })

  test('the arrow menu regenerates with the chosen reason and note', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na důvod ${Date.now()}`
    await addQuestion(page.request, topicId, prompt)
    const requests = await mockRegenerate(page, topicId, prompt)

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const note = menu.getByLabel('Napiš poznámku a pak vyber důvod')
    await note.fill('Možnost B je taky správně.')
    // The note sits above the reasons, not below — otherwise the teacher would
    // reach it only after clicking a label and never add anything to it.
    const box = await menu.boundingBox()
    const noteBox = await note.boundingBox()
    const firstReason = await menu.getByRole('menuitem', { name: 'Nedává smysl' }).boundingBox()
    expect(box && noteBox && firstReason).toBeTruthy()
    expect(noteBox!.y).toBeLessThan(firstReason!.y)
    await menu.getByRole('menuitem', { name: 'Špatné možnosti' }).click()

    await expect(row).toHaveCount(0)
    await expect(page.getByText('Otázka nahrazena novou.')).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      id: expect.any(String),
      reason: 'moznosti',
      note: 'Možnost B je taky správně.',
    })
  })

  test('the whole menu is visible on mobile too (360 px)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na mobilní nabídku ${Date.now()}`
    await addQuestion(page.request, topicId, prompt)
    await mockRegenerate(page, topicId, prompt)

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()

    const box = await menu.boundingBox()
    expect(box, 'the menu has no visible size').toBeTruthy()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(360)
  })
})
