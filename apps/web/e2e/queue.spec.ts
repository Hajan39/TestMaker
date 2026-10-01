import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Generation overview.
 *
 * The queue is filled and emptied via the API, so nothing is generated in the
 * test and the model is never called. States the API cannot simulate (running,
 * failed) are stubbed by the test in the progress response — the screen polls
 * for it by itself while something is waiting.
 */

/** Enqueues the test topic. Returns its id. */
async function enqueue(request: APIRequestContext): Promise<string> {
  const path = await testTopicPath(request)
  const topicId = path.split('/').pop()!
  // Top up to a high count: a topic with questions is not skipped then.
  const response = await request.post('/api/jobs', {
    data: { topicIds: [topicId], mode: 'target', count: 60 },
  })
  expect(response.ok()).toBe(true)
  return topicId
}

/** Empties the queue and the listing so tests start from a clean slate. */
async function clearQueue(request: APIRequestContext): Promise<void> {
  const response = await request.delete('/api/jobs?rozsah=vse')
  expect(response.ok()).toBe(true)
}

/** Stubs counts and a listing in which only unfinished topics remain. */
async function stubOnlyErrors(page: Page): Promise<void> {
  const now = Date.now()
  const counts = { running: 0, queued: 0, done: 0, error: 2 }
  const jobs = [
    {
      id: 'e1',
      topicId: 't3',
      topicName: 'Kosterní soustava',
      place: 'Přírodopis · 8. ročník',
      status: 'error',
      wanted: 12,
      createdCount: 4,
      error: 'Dnešní limit modelu je vyčerpaný. Zkus to prosím zítra.',
      createdAt: new Date(now - 30 * 60_000).toISOString(),
      startedAt: new Date(now - 29 * 60_000).toISOString(),
      finishedAt: new Date(now - 28 * 60_000).toISOString(),
    },
    {
      id: 'e2',
      topicId: 't5',
      topicName: 'Svalová soustava',
      place: 'Přírodopis · 8. ročník',
      status: 'error',
      wanted: 12,
      createdCount: 0,
      error: 'Dnešní limit modelu je vyčerpaný. Zkus to prosím zítra.',
      createdAt: new Date(now - 32 * 60_000).toISOString(),
      startedAt: new Date(now - 31 * 60_000).toISOString(),
      finishedAt: new Date(now - 30 * 60_000).toISOString(),
    },
  ]
  await page.route(
    (url) => url.pathname === '/api/jobs',
    (route, request) => {
      const detail = new URL(request.url()).searchParams.get('vypis') === '1'
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(detail ? { ...counts, jobs } : counts),
      })
    },
  )
}

/** Stubs a listing with every state — the API cannot produce one this varied. */
async function stubJobs(page: Page): Promise<void> {
  const now = Date.now()
  await page.route(
    (url) => url.pathname === '/api/jobs' && url.searchParams.get('vypis') === '1',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          running: 1,
          queued: 1,
          done: 1,
          error: 1,
          jobs: [
            {
              id: 'b1',
              topicId: 't1',
              topicName: 'Dýchací soustava',
              place: 'Přírodopis · 8. ročník',
              status: 'running',
              wanted: 12,
              createdCount: 0,
              error: null,
              createdAt: new Date(now - 9 * 60_000).toISOString(),
              startedAt: new Date(now - 4 * 60_000).toISOString(),
              finishedAt: null,
            },
            {
              id: 'c1',
              topicId: 't2',
              topicName: 'Trávicí soustava',
              place: 'Přírodopis · 8. ročník',
              status: 'queued',
              wanted: 12,
              createdCount: 0,
              error: null,
              createdAt: new Date(now - 8 * 60_000).toISOString(),
              startedAt: null,
              finishedAt: null,
            },
            {
              id: 'e1',
              topicId: 't3',
              topicName: 'Kosterní soustava',
              place: 'Přírodopis · 8. ročník',
              status: 'error',
              wanted: 12,
              createdCount: 3,
              error: 'Dnešní limit modelu je vyčerpaný. Zkus to prosím zítra.',
              createdAt: new Date(now - 30 * 60_000).toISOString(),
              startedAt: new Date(now - 29 * 60_000).toISOString(),
              finishedAt: new Date(now - 28 * 60_000).toISOString(),
            },
            {
              id: 'h1',
              topicId: 't4',
              topicName: 'Oběhová soustava',
              place: 'Přírodopis · 8. ročník',
              status: 'done',
              wanted: 12,
              createdCount: 12,
              error: null,
              createdAt: new Date(now - 60 * 60_000).toISOString(),
              startedAt: new Date(now - 59 * 60_000).toISOString(),
              finishedAt: new Date(now - 58 * 60_000).toISOString(),
            },
          ],
        }),
      }),
  )
}

test.describe('generation overview', () => {
  test.afterEach(async ({ request }) => {
    await clearQueue(request)
  })

  test('shows what is waiting and the queue can be emptied', async ({ page, request }) => {
    await clearQueue(request)
    await enqueue(request)

    await page.goto('/generovani')
    await expect(page.getByRole('heading', { name: 'Průběh generování' })).toBeVisible()
    await expect(page.getByText('Čeká na řadu', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Zkušební téma' })).toBeVisible()

    await page.getByRole('button', { name: 'Vyprázdnit frontu' }).click()
    await page.getByRole('button', { name: 'Vyprázdnit', exact: true }).click()

    await expect(page.getByText('Nic se negeneruje')).toBeVisible()
  })

  test('the indicator with a single waiting job leads straight to its topic', async ({ page, request }) => {
    await clearQueue(request)
    const topicId = await enqueue(request)

    await page.goto('/')
    const indicator = page.getByRole('link', { name: /Ve frontě čeká|Generuji otázky/ })
    await expect(indicator).toBeVisible()
    await indicator.click()

    // It is a single topic and nothing failed — the indicator leads straight to
    // it, not to the general overview that would need further clicking.
    await expect(page).toHaveURL(`/topics/${topicId}`)
  })

  test('the indicator with several jobs leads to the overview, not to one topic', async ({ page }) => {
    await page.route(
      (url) => url.pathname === '/api/jobs' && !url.searchParams.has('vypis'),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ running: 1, queued: 1, done: 0, error: 0 }),
        }),
    )

    await page.goto('/')
    const indicator = page.getByRole('link', { name: /Generuji otázky/ })
    await expect(indicator).toBeVisible()
    await indicator.click()

    await expect(page).toHaveURL(/\/generovani$/)
    await expect(page.getByRole('heading', { name: 'Průběh generování' })).toBeVisible()
  })

  test('the indicator with an error leads to the overview even with a single waiting topic', async ({ page }) => {
    await page.route(
      (url) => url.pathname === '/api/jobs' && !url.searchParams.has('vypis'),
      (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ running: 0, queued: 1, done: 0, error: 1 }),
        }),
    )

    await page.goto('/')
    const indicator = page.getByRole('link', { name: /Ve frontě čeká/ })
    await expect(indicator).toBeVisible()
    await indicator.click()

    await expect(page).toHaveURL(/\/generovani$/)
    await expect(page.getByRole('heading', { name: 'Průběh generování' })).toBeVisible()
  })

  test('an unfinished topic shows why in Czech and can be retried', async ({ page, request }) => {
    await clearQueue(request)
    await enqueue(request)
    await stubJobs(page)

    await page.goto('/generovani')
    // The screen polls by itself while something waits — the stubbed listing
    // arrives with the first such poll.
    await expect(page.getByText('Právě se tvoří', { exact: true })).toBeVisible()
    await expect(page.getByText(/běží \d+ minut/)).toBeVisible()
    await expect(page.getByText('Dnešní limit modelu je vyčerpaný. Zkus to prosím zítra.')).toBeVisible()
    await expect(page.getByText('stihlo vzniknout 3 otázky')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zkusit znovu', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zkusit znovu vše' })).toBeVisible()
  })

  test('after nothing but errors the bar indicator leads to the overview', async ({ page, request }) => {
    await clearQueue(request)
    // For the overview to request the stubbed listing at all, something must be
    // waiting at the start; the stubbed response then says only unfinished topics remain.
    await enqueue(request)
    await stubOnlyErrors(page)

    await page.goto('/')
    // Nothing is running, yet there must be a way to reach the unfinished work.
    // The generation overview (`/generovani`) is not in the bar itself — only the indicator leads there.
    const indicator = page.getByRole('link', { name: '2 témata se nedokončila' })
    await expect(indicator).toBeVisible()
    await indicator.click()
    await expect(page).toHaveURL(/\/generovani$/)
    await expect(page.getByRole('heading', { name: 'Průběh generování' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zkusit znovu vše' })).toBeVisible()
  })

  test('"Zkusit znovu" is reachable on a phone', async ({ page, request }) => {
    await clearQueue(request)
    await enqueue(request)
    await stubOnlyErrors(page)
    await page.setViewportSize({ width: 390, height: 780 })

    await page.goto('/generovani')
    const submitLabel = page.getByRole('button', { name: 'Zkusit znovu', exact: true }).first()
    await expect(submitLabel).toBeVisible()

    // The button must fit on screen entirely — `main` hides horizontal
    // scrolling, so anything past the right edge is unreachable.
    const box = (await submitLabel.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  })

  test('the overview is readable in light and dark mode', async ({ page, request }) => {
    await clearQueue(request)
    await enqueue(request)
    await stubJobs(page)

    await page.goto('/generovani')
    await expect(page.getByText('Právě se tvoří', { exact: true })).toBeVisible()

    for (const theme of ['light', 'dark'] as const) {
      if (theme === 'dark') {
        await page.getByRole('button', { name: 'Tmavý motiv' }).click()
        await expect(page.locator('html')).toHaveClass(/dark/)
      }
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width: width, height: 900 })
        await page.screenshot({ path: `e2e/screenshots/fronta-${theme}-${width}.png`, fullPage: false })
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Podle systému' }).click()
  })

  test('the overview with only errors is readable in light and dark mode', async ({ page, request }) => {
    await clearQueue(request)
    await enqueue(request)
    await stubOnlyErrors(page)

    await page.goto('/generovani')
    await expect(page.getByRole('button', { name: 'Zkusit znovu vše' })).toBeVisible()

    for (const theme of ['light', 'dark'] as const) {
      if (theme === 'dark') {
        await page.getByRole('button', { name: 'Tmavý motiv' }).click()
        await expect(page.locator('html')).toHaveClass(/dark/)
      }
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width: width, height: 900 })
        await page.screenshot({
          path: `e2e/screenshots/fronta-chyby-${theme}-${width}.png`,
          fullPage: false,
        })
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Podle systému' }).click()
  })
})
