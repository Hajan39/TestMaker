import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Přegenerování otázky s důvodem: rozdělené tlačítko v kartě otázky — hlavní
 * část přegeneruje hned (beze změny chování), šipka otevře nabídku šesti
 * důvodů s nepovinnou poznámkou.
 *
 * Model se nevolá — odpověď na `/api/questions/regenerate` je podvržená
 * (`page.route`), stejně jako u „přegenerování skryje starou kartu ihned“
 * v `tema-otazky.spec.ts`. Sleduje se jen tělo požadavku, které rozhraní
 * pošle.
 */

const SUBJECT = 'E2E KONTROLA'
const GRADE = 'E2E přegenerování s důvodem'
const TOPIC = 'Přegenerování s důvodem'

/** Text materiálu musí být dost dlouhý, aby téma nebylo označené jako „málo obsahu“. */
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
  expect(imported.ok(), 'zkušební materiál se nepodařilo naimportovat').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const found2 = results.find((result) => result.topicName.includes(TOPIC))
  expect(found2, `zkušební téma „${TOPIC}“ se v knihovně nenašlo`).toBeTruthy()
  return found2!.topicId
}

async function pridatOtazku(request: APIRequestContext, topicId: string, prompt: string): Promise<string> {
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
  expect(created.ok(), 'zkušební otázku se nepodařilo založit').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

/** Podvrhne kladnou odpověď na regenerate a vrátí požadavky, které přišly na POST. */
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

test.describe('přegenerování s důvodem', () => {
  test('hlavní tlačítko přegeneruje hned, beze změny chování', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na hlavní tlačítko ${Date.now()}`
    await pridatOtazku(page.request, topicId, prompt)
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

  test('nabídka u šipky přegeneruje se zvoleným důvodem a poznámkou', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na důvod ${Date.now()}`
    await pridatOtazku(page.request, topicId, prompt)
    const requests = await mockRegenerate(page, topicId, prompt)

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const poznamka = menu.getByLabel('Napiš poznámku a pak vyber důvod')
    await poznamka.fill('Možnost B je taky správně.')
    // Poznámka stojí nad důvody, ne pod nimi — jinak by ji učitelka psala,
    // až když už klikla na štítek, a nikdy by k ní nedopsala nic navíc.
    const box = await menu.boundingBox()
    const poznamkaBox = await poznamka.boundingBox()
    const prvniDuvod = await menu.getByRole('menuitem', { name: 'Nedává smysl' }).boundingBox()
    expect(box && poznamkaBox && prvniDuvod).toBeTruthy()
    expect(poznamkaBox!.y).toBeLessThan(prvniDuvod!.y)
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

  test('nabídka je celá vidět i na mobilu (360 px)', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na mobilní nabídku ${Date.now()}`
    await pridatOtazku(page.request, topicId, prompt)
    await mockRegenerate(page, topicId, prompt)

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()

    const box = await menu.boundingBox()
    expect(box, 'nabídka nemá viditelný rozměr').toBeTruthy()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(360)
  })
})
