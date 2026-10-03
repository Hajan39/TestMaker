import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Easier and harder versions of a question from its card: the menu next to
 * „Přegenerovat" (see `regeneration.spec.ts`) extended with „Lehčí verze" and
 * „Těžší verze", plus the „Verze: …" row linking to related cards.
 *
 * The model is not called — the `/api/questions/variant` response is faked
 * (`page.route`), just like regeneration in `regeneration.spec.ts`. The viewer
 * (role `nahled`) is in a separate `test.describe` with the login config
 * (port 3101), like the rest of `role.spec.ts`.
 */

const SUBJECT = 'E2E KONTROLA'
const GRADE = 'E2E verze otázky'
const TOPIC = 'Verze otázky na kartě'

/** The material text must be long enough for the topic not to be flagged as low on content. */
const TEXT =
  'Fotosyntéza přeměňuje sluneční energii, vodu a oxid uhličitý na cukry a kyslík v zelených rostlinách. '.repeat(12)

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
          contentHash: 'e2e-verze-otazky-v1',
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

async function addQuestion(
  request: APIRequestContext,
  topicId: string,
  prompt: string,
  difficulty: 1 | 2 | 3 = 2,
): Promise<string> {
  const created = await request.post('/api/questions', {
    data: {
      topicId,
      question: {
        type: 'short_answer',
        difficulty,
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

/** Fakes a successful `/api/questions/variant` response and returns the requests that arrived via POST. */
async function mockVariant(
  page: Page,
  topicId: string,
  originalId: string,
  prompt: string,
): Promise<Record<string, unknown>[]> {
  const requests: Record<string, unknown>[] = []
  await page.route('**/api/questions/regenerate', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { configured: true } })
      return
    }
    await route.continue()
  })
  await page.route('**/api/questions/variant', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    requests.push(body)
    const direction = body.direction as 'easier' | 'harder'
    await route.fulfill({
      json: {
        question: {
          id: `verze-${requests.length}-${Date.now()}`,
          topicId,
          materialId: null,
          source: 'ai',
          status: 'approved',
          createdAt: new Date().toISOString(),
          variantOf: originalId,
          type: 'short_answer',
          payload: { prompt: `${prompt} (${direction === 'easier' ? 'lehčí' : 'těžší'})`, answer: 'odpověď', acceptedAnswers: [] },
          blocks: [],
          points: 1,
          difficulty: direction === 'easier' ? 1 : 3,
        },
      },
    })
  })
  return requests
}

test.describe('question versions on the card', () => {
  test('„Lehčí verze“ sends direction: easier and the new card appears', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na lehčí verzi ${Date.now()}`
    const originalId = await addQuestion(page.request, topicId, prompt, 2)
    const requests = await mockVariant(page, topicId, originalId, prompt)

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Lehčí verze' }).click()

    await expect(page.getByTestId('toast-question-variant-easier')).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ id: originalId, direction: 'easier' })

    // The new card (version) appears right away, without waiting for a full page refresh.
    await expect(page.locator('li[data-question-id]', { hasText: `${prompt} (lehčí)` })).toBeVisible()
  })

  test('at difficulty 1 „Lehčí verze“ is disabled, at difficulty 3 „Těžší verze“', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const promptEasy = `Otázka nejlehčí ${Date.now()}`
    const promptHard = `Otázka nejtěžší ${Date.now()}`
    const easyId = await addQuestion(page.request, topicId, promptEasy, 1)
    await addQuestion(page.request, topicId, promptHard, 3)
    await mockVariant(page, topicId, easyId, promptEasy)

    await page.goto(`/topics/${topicId}`)

    const rowEasy = page.locator('li[data-question-id]', { hasText: promptEasy })
    await rowEasy.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    let menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Lehčí verze' })).toBeDisabled()
    await expect(menu.getByRole('menuitem', { name: 'Těžší verze' })).toBeEnabled()
    await page.keyboard.press('Escape')

    const rowHard = page.locator('li[data-question-id]', { hasText: promptHard })
    await rowHard.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Těžší verze' })).toBeDisabled()
    await expect(menu.getByRole('menuitem', { name: 'Lehčí verze' })).toBeEnabled()
  })

  test('the versions row leads to the version card and briefly highlights it', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na řádek verzí ${Date.now()}`
    const originalId = await addQuestion(page.request, topicId, prompt, 2)

    // Enough extra questions (created after the original, so above it) that
    // the original is out of view after the page loads — otherwise the test
    // would verify nothing about scrolling and highlighting, since the target
    // would be visible anyway, without any scroll.
    for (let i = 0; i < 20; i += 1) {
      await addQuestion(page.request, topicId, `Otázka na vycpávku ${Date.now()}-${i}`, 2)
    }

    await mockVariant(page, topicId, originalId, prompt)

    await page.goto(`/topics/${topicId}`)
    const originalRow = page.locator('li[data-question-id]', { hasText: prompt })
    await originalRow.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: 'Těžší verze' }).click()

    const newRow = page.locator('li[data-question-id]', { hasText: `${prompt} (těžší)` })
    await expect(newRow).toBeVisible()

    // The original card now shows a row linking to its harder version.
    // Scrolling to this link deliberately moves the view away from the new card
    // (it is among the padding on top, the original below) — only then does it
    // make sense to check that clicking the link scrolls back.
    const versionLink = originalRow.getByRole('button', { name: 'těžší' })
    await versionLink.scrollIntoViewIfNeeded()
    await expect(versionLink).toBeVisible()
    await expect(newRow).not.toBeInViewport()

    await versionLink.click()
    // The highlight appears right after the click (still during smooth
    // scrolling) and disappears by itself — the card does not stay lit forever.
    await expect(newRow).toHaveClass(/bg-brand-bg/)
    await expect(newRow).toBeInViewport()
    await expect(newRow).not.toHaveClass(/bg-brand-bg/, { timeout: 3_000 })

    // The version card itself also shows a row back to its root.
    await expect(newRow.getByRole('button', { name: 'lehčí' })).toBeVisible()
  })
})

/**
 * Easier/harder version of a whole test (builder, `/tests/[id]`) — a button in
 * the header. The model is not called; `/api/tests/variant` is a faked NDJSON
 * stream (`page.route`), just like the single-question version above.
 */
test.describe('test version in the builder', () => {
  async function createTest(request: APIRequestContext, title: string): Promise<string> {
    const bank = await request.get('/api/questions?status=approved&limit=1')
    expect(bank.ok()).toBe(true)
    const { items } = (await bank.json()) as { items: { id: string }[] }
    expect(items.length, 'the library has no approved questions').toBeGreaterThan(0)

    const created = await request.post('/api/tests', {
      data: {
        title,
        description: null,
        graded: true,
        templateId: 'builtin-klasicka',
        gradeId: null,
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        variants: 1,
        showKey: true,
        items: [{ kind: 'question', questionId: items[0]!.id }],
      },
    })
    expect(created.ok(), 'failed to create the test').toBe(true)
    const { id } = (await created.json()) as { id: string }
    return id
  }

  /**
   * Fakes the `/api/tests/variant` NDJSON stream: start (already with the
   * copy's id) → progress → done. With `withoutDone` the stream ends early —
   * as when the platform kills the function after `maxDuration`.
   */
  async function mockTestVariant(page: Page, newTestId: string, withoutDone = false): Promise<void> {
    await page.route('**/api/tests/variant', async (route) => {
      const events = [
        { type: 'start', total: 2, testId: newTestId },
        { type: 'progress', done: 1, total: 2 },
        ...(withoutDone ? [] : [{ type: 'done', testId: newTestId, replaced: 0, generated: 2, kept: 0 }]),
      ]
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: events.map((event) => JSON.stringify(event)).join('\n') + '\n',
      })
    })
  }

  test('the button with a faked stream opens the new test', async ({ page }) => {
    const title = `E2E verze písemky ${Date.now()}`
    const testId = await createTest(page.request, title)
    const newId = await createTest(page.request, `${title} – cíl přesměrování`)
    await mockTestVariant(page, newId)

    await page.goto(`/tests/${testId}`)
    await page.getByRole('button', { name: 'Verze písemky' }).click()
    await page.getByRole('menuitem', { name: 'Lehčí verze písemky' }).click()

    await expect(page).toHaveURL(new RegExp(`/tests/${newId}$`))
    await expect(page.getByTestId('toast-variant-done')).toBeVisible()
  })

  test('a stream without an ending opens the partial copy with a warning', async ({ page }) => {
    const title = `E2E useknutá verze ${Date.now()}`
    const testId = await createTest(page.request, title)
    const newId = await createTest(page.request, `${title} – částečná kopie`)
    await mockTestVariant(page, newId, true)

    await page.goto(`/tests/${testId}`)
    await page.getByRole('button', { name: 'Verze písemky' }).click()
    await page.getByRole('menuitem', { name: 'Těžší verze písemky' }).click()

    await expect(page).toHaveURL(new RegExp(`/tests/${newId}$`))
    await expect(page.getByTestId('toast-variant-partial')).toBeVisible()
  })

  test('unsaved changes offer saving instead of a request', async ({ page }) => {
    const title = `E2E neuložená verze ${Date.now()}`
    const testId = await createTest(page.request, title)
    let queries = 0
    await page.route('**/api/tests/variant', async (route) => {
      queries += 1
      await route.abort()
    })

    await page.goto(`/tests/${testId}`)
    // Make an unsaved change — renaming the title without saving. Typed
    // character by character (`pressSequentially`) into the selected text, not
    // `.fill()`: in webkit on this page (a test with an item, hence with
    // dnd-kit's `SortableContext`) that sets the value without React learning
    // about the change via `onChange`.
    const edited = `${title} (upraveno)`
    const titleInput = page.getByLabel('Název písemky')
    await titleInput.selectText()
    await titleInput.pressSequentially(edited)
    await expect(titleInput).toHaveValue(edited)

    await page.getByRole('button', { name: 'Verze písemky' }).click()
    await page.getByRole('menuitem', { name: 'Těžší verze písemky' }).click()

    await expect(page.getByTestId('toast-save-before-variant')).toBeVisible()
    expect(queries).toBe(0)
  })
})
