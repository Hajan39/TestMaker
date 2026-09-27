import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Lehčí a těžší verze otázky z karty: rozšíření nabídky u „Přegenerovat"
 * (viz `pregenerovani.spec.ts`) o „Lehčí verze" a „Těžší verze" a řádek
 * „Verze: …" s odkazy na související karty.
 *
 * Model se nevolá — odpověď na `/api/questions/variant` je podvržená
 * (`page.route`), stejně jako regenerace v `pregenerovani.spec.ts`. Náhled
 * (role `nahled`) je v samostatném `test.describe` s přihlašovací konfigurací
 * (port 3101), stejně jako zbytek souboru `role.spec.ts`.
 */

const SUBJECT = 'E2E KONTROLA'
const GRADE = 'E2E verze otázky'
const TOPIC = 'Verze otázky na kartě'

/** Text materiálu musí být dost dlouhý, aby téma nebylo označené jako „málo obsahu“. */
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
  expect(imported.ok(), 'zkušební materiál se nepodařilo naimportovat').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const found2 = results.find((result) => result.topicName.includes(TOPIC))
  expect(found2, `zkušební téma „${TOPIC}“ se v knihovně nenašlo`).toBeTruthy()
  return found2!.topicId
}

async function pridatOtazku(
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
  expect(created.ok(), 'zkušební otázku se nepodařilo založit').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

/** Podvrhne kladnou odpověď na `/api/questions/variant` a vrátí požadavky, které přišly na POST. */
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

test.describe('verze otázky na kartě', () => {
  test('„Lehčí verze“ pošle direction: easier a nová karta se objeví', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na lehčí verzi ${Date.now()}`
    const originalId = await pridatOtazku(page.request, topicId, prompt, 2)
    const requests = await mockVariant(page, topicId, originalId, prompt)

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Lehčí verze' }).click()

    await expect(page.getByText('Vznikla lehčí verze otázky.')).toBeVisible()
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({ id: originalId, direction: 'easier' })

    // Nová karta (verze) se objeví hned, bez čekání na obnovení celé stránky.
    await expect(page.locator('li[data-question-id]', { hasText: `${prompt} (lehčí)` })).toBeVisible()
  })

  test('u obtížnosti 1 je „Lehčí verze“ vypnutá, u obtížnosti 3 „Těžší verze“', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const promptLehka = `Otázka nejlehčí ${Date.now()}`
    const promptTezka = `Otázka nejtěžší ${Date.now()}`
    const idLehka = await pridatOtazku(page.request, topicId, promptLehka, 1)
    const idTezka = await pridatOtazku(page.request, topicId, promptTezka, 3)
    await mockVariant(page, topicId, idLehka, promptLehka)

    await page.goto(`/topics/${topicId}`)

    const rowLehka = page.locator('li[data-question-id]', { hasText: promptLehka })
    await rowLehka.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    let menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Lehčí verze' })).toBeDisabled()
    await expect(menu.getByRole('menuitem', { name: 'Těžší verze' })).toBeEnabled()
    await page.keyboard.press('Escape')

    const rowTezka = page.locator('li[data-question-id]', { hasText: promptTezka })
    await rowTezka.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Těžší verze' })).toBeDisabled()
    await expect(menu.getByRole('menuitem', { name: 'Lehčí verze' })).toBeEnabled()
  })

  test('řádek verzí vede na kartu verze a krátce ji zvýrazní', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na řádek verzí ${Date.now()}`
    const originalId = await pridatOtazku(page.request, topicId, prompt, 2)
    await mockVariant(page, topicId, originalId, prompt)

    await page.goto(`/topics/${topicId}`)
    const originalRow = page.locator('li[data-question-id]', { hasText: prompt })
    await originalRow.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: 'Těžší verze' }).click()

    const newRow = page.locator('li[data-question-id]', { hasText: `${prompt} (těžší)` })
    await expect(newRow).toBeVisible()

    // Původní karta teď ukazuje řádek s odkazem na svoji těžší verzi.
    const versionLink = originalRow.getByRole('button', { name: 'těžší' })
    await expect(versionLink).toBeVisible()
    await versionLink.click()

    await expect(newRow).toBeInViewport()
  })
})
