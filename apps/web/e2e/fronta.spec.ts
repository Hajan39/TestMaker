import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Přehled generování.
 *
 * Fronta se plní i vyprazdňuje přes API, takže se v testu nic negeneruje a
 * model se nevolá. Stavy, které přes API nasimulovat nejde (běžící, spadlé),
 * si test podstrčí sám v odpovědi na dotaz o průběh — obrazovka se na ni
 * ptá sama, dokud něco čeká.
 */

/** Zařadí zkušební téma do fronty. Vrací jeho id. */
async function enqueue(request: APIRequestContext): Promise<string> {
  const path = await testTopicPath(request)
  const topicId = path.split('/').pop()!
  // Doplnění na vysoký počet: téma s otázkami se u něj nepřeskakuje.
  const response = await request.post('/api/jobs', {
    data: { topicIds: [topicId], mode: 'target', count: 60 },
  })
  expect(response.ok()).toBe(true)
  return topicId
}

/** Vyprázdní frontu i výpis, ať testy začínají na čistém stole. */
async function clearQueue(request: APIRequestContext): Promise<void> {
  const response = await request.delete('/api/jobs?rozsah=vse')
  expect(response.ok()).toBe(true)
}

/** Podstrčí výpis se všemi stavy — přes API je takhle pestrý nevyrobíme. */
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

test.describe('přehled generování', () => {
  test.afterEach(async ({ request }) => {
    await clearQueue(request)
  })

  test('ukáže, co čeká, a frontu jde vyprázdnit', async ({ page, request }) => {
    await clearQueue(request)
    await enqueue(request)

    await page.goto('/generovani')
    await expect(page.getByRole('heading', { name: 'Průběh generování' })).toBeVisible()
    await expect(page.getByText('Čeká na řadu (1)')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Zkušební téma' })).toBeVisible()

    await page.getByRole('button', { name: 'Vyprázdnit frontu' }).click()
    await page.getByRole('button', { name: 'Vyprázdnit', exact: true }).click()

    await expect(page.getByText('Nic se negeneruje')).toBeVisible()
  })

  test('ukazatel v liště dovede na přehled i z jiné stránky', async ({ page, request }) => {
    await clearQueue(request)
    await enqueue(request)

    await page.goto('/questions')
    const ukazatel = page.getByRole('link', { name: /Ve frontě čeká|Generuji otázky/ })
    await expect(ukazatel).toBeVisible()
    await ukazatel.click()

    await expect(page).toHaveURL(/\/generovani$/)
    await expect(page.getByRole('heading', { name: 'Průběh generování' })).toBeVisible()
  })

  test('u nedokončeného tématu je česky vidět proč a jde to zkusit znovu', async ({ page, request }) => {
    await clearQueue(request)
    await enqueue(request)
    await stubJobs(page)

    await page.goto('/generovani')
    // Obrazovka se doptává sama, dokud něco čeká — podstrčený výpis přijde
    // s prvním takovým dotazem.
    await expect(page.getByText('Právě se tvoří (1)')).toBeVisible()
    await expect(page.getByText(/běží \d+ minut/)).toBeVisible()
    await expect(page.getByText('Dnešní limit modelu je vyčerpaný. Zkus to prosím zítra.')).toBeVisible()
    await expect(page.getByText('stihlo vzniknout 3 otázky')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zkusit znovu', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Zkusit znovu \(1\)/ })).toBeVisible()
  })

  test('přehled je čitelný ve světlém i tmavém režimu', async ({ page, request }) => {
    await clearQueue(request)
    await enqueue(request)
    await stubJobs(page)

    await page.goto('/generovani')
    await expect(page.getByText('Právě se tvoří (1)')).toBeVisible()

    for (const motiv of ['svetla', 'tmava'] as const) {
      if (motiv === 'tmava') {
        await page.getByRole('button', { name: 'Tmavý motiv' }).click()
        await expect(page.locator('html')).toHaveClass(/dark/)
      }
      await page.screenshot({ path: `e2e/screenshots/fronta-${motiv}.png`, fullPage: false })
    }

    await page.getByRole('button', { name: 'Podle systému' }).click()
  })
})
