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

/** Podstrčí počty i výpis, ve kterém zbyla jen nedokončená témata. */
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
    await expect(page.getByText('Čeká na řadu', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Zkušební téma' })).toBeVisible()

    await page.getByRole('button', { name: 'Vyprázdnit frontu' }).click()
    await page.getByRole('button', { name: 'Vyprázdnit', exact: true }).click()

    await expect(page.getByText('Nic se negeneruje')).toBeVisible()
  })

  test('ukazatel s jedinou čekající úlohou vede rovnou do jejího tématu', async ({ page, request }) => {
    await clearQueue(request)
    const topicId = await enqueue(request)

    await page.goto('/')
    const ukazatel = page.getByRole('link', { name: /Ve frontě čeká|Generuji otázky/ })
    await expect(ukazatel).toBeVisible()
    await ukazatel.click()

    // Jde o jediné téma a nic neselhalo — ukazatel vede rovnou do něj, ne do
    // obecného přehledu, kam by se pak muselo proklikávat dál.
    await expect(page).toHaveURL(`/topics/${topicId}`)
  })

  test('ukazatel s víc úlohami vede do přehledu, ne do jednoho tématu', async ({ page }) => {
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
    const ukazatel = page.getByRole('link', { name: /Generuji otázky/ })
    await expect(ukazatel).toBeVisible()
    await ukazatel.click()

    await expect(page).toHaveURL(/\/generovani$/)
    await expect(page.getByRole('heading', { name: 'Průběh generování' })).toBeVisible()
  })

  test('ukazatel s chybou vede do přehledu, i kdyby zbylo jediné čekající téma', async ({ page }) => {
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
    const ukazatel = page.getByRole('link', { name: /Ve frontě čeká/ })
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
    await expect(page.getByText('Právě se tvoří', { exact: true })).toBeVisible()
    await expect(page.getByText(/běží \d+ minut/)).toBeVisible()
    await expect(page.getByText('Dnešní limit modelu je vyčerpaný. Zkus to prosím zítra.')).toBeVisible()
    await expect(page.getByText('stihlo vzniknout 3 otázky')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zkusit znovu', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zkusit znovu vše' })).toBeVisible()
  })

  test('po samých chybách vede do přehledu ukazatel v liště', async ({ page, request }) => {
    await clearQueue(request)
    // Aby si přehled o podstrčený výpis vůbec řekl, musí na začátku něco čekat;
    // podstrčená odpověď pak řekne, že zbyla jen nedokončená témata.
    await enqueue(request)
    await stubOnlyErrors(page)

    await page.goto('/')
    // Nic neběží, a přesto musí být kudy se k nedodělané práci dostat. Přehled
    // generování (`/generovani`) v liště samotné není — vede tam jen ukazatel.
    const ukazatel = page.getByRole('link', { name: '2 témata se nedokončila' })
    await expect(ukazatel).toBeVisible()
    await ukazatel.click()
    await expect(page).toHaveURL(/\/generovani$/)
    await expect(page.getByRole('heading', { name: 'Průběh generování' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Zkusit znovu vše' })).toBeVisible()
  })

  test('na telefonu jde na „Zkusit znovu“ dosáhnout', async ({ page, request }) => {
    await clearQueue(request)
    await enqueue(request)
    await stubOnlyErrors(page)
    await page.setViewportSize({ width: 390, height: 780 })

    await page.goto('/generovani')
    const tlacitko = page.getByRole('button', { name: 'Zkusit znovu', exact: true }).first()
    await expect(tlacitko).toBeVisible()

    // Tlačítko se musí celé vejít do obrazovky — `main` vodorovné rolování
    // skrývá, takže cokoli za pravým okrajem je nedosažitelné.
    const box = (await tlacitko.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  })

  test('přehled je čitelný ve světlém i tmavém režimu', async ({ page, request }) => {
    await clearQueue(request)
    await enqueue(request)
    await stubJobs(page)

    await page.goto('/generovani')
    await expect(page.getByText('Právě se tvoří', { exact: true })).toBeVisible()

    for (const motiv of ['svetla', 'tmava'] as const) {
      if (motiv === 'tmava') {
        await page.getByRole('button', { name: 'Tmavý motiv' }).click()
        await expect(page.locator('html')).toHaveClass(/dark/)
      }
      for (const sirka of [1440, 390]) {
        await page.setViewportSize({ width: sirka, height: 900 })
        await page.screenshot({ path: `e2e/screenshots/fronta-${motiv}-${sirka}.png`, fullPage: false })
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Podle systému' }).click()
  })

  test('přehled se samými chybami je čitelný ve světlém i tmavém režimu', async ({ page, request }) => {
    await clearQueue(request)
    await enqueue(request)
    await stubOnlyErrors(page)

    await page.goto('/generovani')
    await expect(page.getByRole('button', { name: 'Zkusit znovu vše' })).toBeVisible()

    for (const motiv of ['svetla', 'tmava'] as const) {
      if (motiv === 'tmava') {
        await page.getByRole('button', { name: 'Tmavý motiv' }).click()
        await expect(page.locator('html')).toHaveClass(/dark/)
      }
      for (const sirka of [1440, 390]) {
        await page.setViewportSize({ width: sirka, height: 900 })
        await page.screenshot({
          path: `e2e/screenshots/fronta-chyby-${motiv}-${sirka}.png`,
          fullPage: false,
        })
      }
    }

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Podle systému' }).click()
  })
})
