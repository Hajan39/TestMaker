import { expect, test, type Page } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Generation progress on the topic screen.
 *
 * The model is never called in the test: the `/api/generate` call is replaced
 * in the browser by our own event stream sending the same as the server —
 * just with fixed content and at a pace at which the progress can be followed.
 *
 * The point is what the teacher sees while it runs: how many questions exist
 * already and that they appear in the list right away, not at the end.
 */

const FIRST = 'Kde probíhá fotosyntéza — zkušební otázka?'
const SECOND = 'Co při fotosyntéze vzniká — zkušební otázka?'

/** Fake generation event stream. `step` is the pause between events. */
async function stubGenerating(page: Page, step = 400): Promise<void> {
  await page.addInitScript(
    ({ step, first, second }) => {
      const question = (id: string, prompt: string) => ({
        id,
        topicId: 'zkouska',
        materialId: null,
        source: 'ai',
        status: 'draft',
        createdAt: new Date().toISOString(),
        type: 'single_choice',
        payload: { prompt, options: ['V kořenech', 'V listech'], correctIndex: 1 },
        blocks: [],
        points: 1,
        difficulty: 2,
      })

      const events = [
        { type: 'start' },
        { type: 'saved', created: 1, questions: [question('zkouska-1', first)] },
        { type: 'progress', done: 1, total: 2 },
        { type: 'saved', created: 2, questions: [question('zkouska-2', second)] },
        { type: 'done', created: 2, rejected: 1, failedCalls: 0, topicId: 'zkouska', sources: 1, models: ['zkouska'] },
      ]

      const original = window.fetch.bind(window)
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (!url.includes('/api/generate')) return original(input, init)

        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            let index = 0
            const push = () => {
              if (index >= events.length) {
                controller.close()
                return
              }
              controller.enqueue(encoder.encode(`${JSON.stringify(events[index++])}\n`))
              setTimeout(push, step)
            }
            setTimeout(push, step)
          },
        })
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
          }),
        )
      }
    },
    { step, first: FIRST, second: SECOND },
  )
}

/** Starts generation on the topic page. Returns once the button has registered. */
async function run(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: /generovat otázky$/ })
  await expect(button).toBeEnabled()
  await button.click()
}

test.describe('generation progress in a topic', () => {
  test('reports how many questions exist and shows them in the list right away', async ({ page, request }) => {
    const path = await testTopicPath(request)
    // The pace is deliberately slow: the intermediate state ("first batch done")
    // must be reliably visible even in a slower browser.
    await stubGenerating(page, 1000)
    await page.goto(path)

    const generate = page.getByRole('button', { name: /generovat otázky$/ })
    test.skip((await generate.count()) === 0, 'Generation is not configured.')
    await run(page)

    // Before the first batch arrives, at least the start is visible.
    await expect(page.getByTestId('generation-progress')).toBeVisible()

    // First saved batch: the count and the question itself, still while running.
    await expect(page.getByTestId('generation-progress')).toHaveAttribute('data-done', '1')
    await expect(page.getByText(FIRST)).toBeVisible()

    // The second batch joins it — the list grows without waiting for the end.
    await expect(page.getByTestId('generation-progress')).toHaveAttribute('data-done', '2')
    await expect(page.getByText(SECOND)).toBeVisible()

    // The end says what was created and what was discarded — once, in the card.
    // The toast only signals that it's done.
    const outcome = page.getByTestId('generation-outcome')
    await expect(outcome).toHaveCount(1)
    await expect(outcome).toHaveAttribute('data-created', '2')
    await expect(outcome).toHaveAttribute('data-rejected', '1')
    // New questions show right away as cards below — the toast no longer links
    // anywhere, draft review in the topic is gone.
    await expect(page.getByTestId('toast-generation-done')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Zkontrolovat' })).toHaveCount(0)
  })

  test('progress is readable in light and dark mode', async ({ page, request }) => {
    const path = await testTopicPath(request)
    // A slower pace so a screenshot mid-work can be taken.
    await stubGenerating(page, 1200)
    await page.goto(path)

    const generate = page.getByRole('button', { name: /generovat otázky$/ })
    test.skip((await generate.count()) === 0, 'Generation is not configured.')

    for (const theme of ['light', 'dark'] as const) {
      if (theme === 'dark') {
        await page.getByRole('button', { name: 'Tmavý motiv' }).click()
        await expect(page.locator('html')).toHaveClass(/dark/)
      }

      await run(page)
      await expect(page.getByTestId('generation-progress')).toHaveAttribute('data-done', '1')
      await expect(page.getByText(FIRST)).toBeVisible()
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.screenshot({
        path: `e2e/screenshots/prubeh-generovani-${theme}-1440.png`,
        fullPage: false,
      })

      // It must run to the end, otherwise the second pass would start midway.
      await expect(page.getByTestId('generation-outcome')).toBeVisible({ timeout: 10_000 })
      // State after finishing: the run summary is in the card once, the toast only says done.
      await page.screenshot({ path: `e2e/screenshots/tema-pote-${theme}-1440.png`, fullPage: false })

      // Narrow screen last: narrowing the window remounts the topic workspace
      // (the layout below `sm` is composed differently) and the run summary disappears.
      await page.setViewportSize({ width: 390, height: 900 })
      await page.screenshot({
        path: `e2e/screenshots/prubeh-generovani-${theme}-390.png`,
        fullPage: false,
      })
      await page.setViewportSize({ width: 1440, height: 900 })
    }

    // Restore the theme so the next test doesn't start in the dark.
    await page.getByRole('button', { name: 'Podle systému' }).click()
  })
})
