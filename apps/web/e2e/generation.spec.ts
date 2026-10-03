import { expect, test, type APIRequestContext } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Question generation in a topic: the card shows only the button, count and
 * difficulty — no type selection and no "Doplnit na celkový počet" mode (that's
 * only for bulk generation). An excluded (or missing) material disables
 * generation with an explanation, and a topic with no content at all offers an
 * empty state with two paths.
 */

const SUBJECT = 'E2E GENEROVANI'
const GRADE = 'E2E generování'

const TEXT =
  'Koloběh látek v přírodě propojuje živé organismy s neživým prostředím prostřednictvím výměny látek a energie. '.repeat(
    12,
  )

/** Creates a test topic with one material and returns its id. */
async function ensureTopicWithMaterial(request: APIRequestContext, topic: string): Promise<string> {
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
          contentHash: `e2e-generovani-v1:${topic}`,
        },
      ],
    },
  })
  expect(imported.ok(), 'failed to import the test material').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(topic)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const found2 = results.find((result) => result.topicName.includes(topic))
  expect(found2, `test topic "${topic}" not found in the library`).toBeTruthy()
  return found2!.topicId
}

/**
 * Creates an empty topic (no materials, no questions) manually via the library,
 * not via material import — exactly the path of a teacher who wants to write
 * questions herself. Subject and grade are new each time (name with a timestamp)
 * so test runs don't collide on one item and existing ones needn't be handled.
 */
async function ensureEmptyTopic(request: APIRequestContext, name: string): Promise<string> {
  const subject = await request.post('/api/library', {
    data: { kind: 'subject', name: `${SUBJECT} prázdné ${Date.now()}` },
  })
  expect(subject.ok(), 'failed to create the test subject').toBe(true)
  const { id: subjectId } = (await subject.json()) as { id: string }

  const grade = await request.post('/api/library', {
    data: { kind: 'grade', name: `${GRADE} prázdné ${Date.now()}`, parentId: subjectId },
  })
  expect(grade.ok(), 'failed to create the test grade').toBe(true)
  const { id: gradeId } = (await grade.json()) as { id: string }

  const created = await request.post('/api/library', {
    data: { kind: 'topic', name, parentId: gradeId },
  })
  expect(created.ok(), 'failed to create the test topic').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

test.describe('question generation in a topic', () => {
  test('the card shows only count and difficulty, default count is 10', async ({ page, request }) => {
    const path = await testTopicPath(request)
    await page.goto(path)

    const generate = page.getByRole('button', { name: 'Vygenerovat otázky' })
    test.skip((await generate.count()) === 0, 'Generation is not configured.')

    // No type selection or top-up mode — those belong to bulk generation only.
    await expect(page.getByRole('button', { name: 'Nastavení generování' })).toHaveCount(0)
    await expect(page.getByTestId('generate-settings-full')).toHaveCount(0)

    // `#generate-difficulty`, not the generic label — the question filter below
    // has a difficulty with the same name.
    const difficulty = page.locator('#generate-difficulty')
    await expect(page.getByLabel('Počet', { exact: true })).toHaveValue('10')
    await expect(difficulty).toHaveText('Promíchat')
    const hint = page.getByTestId('generate-hint')
    await expect(hint).toHaveAttribute('data-state', 'will-create')
    await expect(hint).toHaveAttribute('data-count', '10')
    await expect(hint).toHaveAttribute('data-materials', '1')

    await page.getByLabel('Počet', { exact: true }).fill('3')
    await expect(hint).toHaveAttribute('data-count', '3')
    await expect(hint).toHaveAttribute('data-materials', '1')

    await difficulty.click()
    await page.getByRole('option', { name: 'Těžké' }).click()
    await expect(difficulty).toHaveText('Těžké')
  })

  test('excluding the only material disables generation with an explanation', async ({ page, request }) => {
    // A digits-only suffix is ignored when grouping similar topic names
    // (`topicTokens` in `packages/core/src/extract/grouping.ts` drops numeric
    // tokens) — `toString(36)` puts letters into the suffix so two runs of this
    // test don't merge into one topic with several materials.
    const topicId = await ensureTopicWithMaterial(request, `Vynechaný materiál ${Date.now().toString(36)}`)
    await page.goto(`/topics/${topicId}`)

    const generate = page.getByRole('button', { name: 'Vygenerovat otázky' })
    test.skip((await generate.count()) === 0, 'Generation is not configured.')
    await expect(generate).toBeEnabled()

    const stripHeader = page.getByRole('button', { name: /^Materiály/ })
    if ((await stripHeader.getAttribute('aria-expanded')) !== 'true') await stripHeader.click()
    const materialId = await page.locator('[data-material-id]').first().getAttribute('data-material-id')
    expect(materialId, 'failed to read the material id from the page').toBeTruthy()

    const excluded = await request.patch('/api/materials', { data: { id: materialId, excluded: true } })
    expect(excluded.ok()).toBe(true)
    await page.reload()

    await expect(page.getByRole('button', { name: 'Vygenerovat otázky' })).toBeDisabled()
    await expect(page.getByTestId('generate-hint')).toHaveAttribute('data-state', 'no-material')
  })

  test('an empty topic offers uploading a material and writing a question', async ({ page, request }) => {
    const topicId = await ensureEmptyTopic(request, `Prázdné téma nahrání ${Date.now()}`)
    await page.goto(`/topics/${topicId}`)

    await expect(page.getByTestId('topic-empty')).toBeVisible()
    // Neither the generation card nor the materials strip shows in an empty
    // topic — just a single prompt with both paths.
    await expect(page.getByRole('button', { name: 'Vygenerovat otázky' })).toHaveCount(0)

    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Nahrát materiál' }).click()
    const chooser = await chooserPromise
    await chooser.setFiles({
      name: 'Nahraný z prázdného tématu.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(TEXT, 'utf8'),
    })

    await expect(page.getByTestId('toast-materials-uploaded')).toContainText('1')
    await expect(page.getByTestId('topic-empty')).toHaveCount(0)
    await expect(page.getByText('Nahraný z prázdného tématu.txt')).toBeVisible()
  })

  test('empty topic: writing a question opens the form directly', async ({ page, request }) => {
    const topicId = await ensureEmptyTopic(request, `Prázdné téma otázka ${Date.now()}`)
    await page.goto(`/topics/${topicId}`)

    await expect(page.getByTestId('topic-empty')).toBeVisible()
    await page.getByRole('button', { name: 'Napsat otázku' }).click()

    const form = page.getByTestId('new-question-form')
    await expect(form).toBeVisible()
    const prompt = `Otázka z prázdného tématu ${Date.now()}`
    await form.getByLabel('Typ').click()
    await page.getByRole('option', { name: 'Krátká odpověď' }).click()
    await form.getByLabel('Zadání').fill(prompt)
    await form.getByLabel('Správná odpověď').fill('odpověď')
    await form.getByRole('button', { name: 'Uložit' }).click()

    await expect(page.getByTestId('topic-empty')).toHaveCount(0)
    await expect(page.locator('li[data-question-id]', { hasText: prompt })).toBeVisible()
  })
})
