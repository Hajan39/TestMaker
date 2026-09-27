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

    // Dost otázek navíc (vzniklých až po originálu, tedy nad ním), ať
    // originál po načtení stránky není v zorném poli — jinak by test na
    // posun a zvýraznění nic neověřil, protože by cíl byl vidět tak jako
    // tak, i bez jakéhokoli posunu.
    for (let i = 0; i < 20; i += 1) {
      await pridatOtazku(page.request, topicId, `Otázka na vycpávku ${Date.now()}-${i}`, 2)
    }

    await mockVariant(page, topicId, originalId, prompt)

    await page.goto(`/topics/${topicId}`)
    const originalRow = page.locator('li[data-question-id]', { hasText: prompt })
    await originalRow.getByRole('button', { name: 'Přegenerovat s důvodem' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: 'Těžší verze' }).click()

    const newRow = page.locator('li[data-question-id]', { hasText: `${prompt} (těžší)` })
    await expect(newRow).toBeVisible()

    // Původní karta teď ukazuje řádek s odkazem na svoji těžší verzi. Scroll
    // na tenhle odkaz schválně přesune pohled pryč z nové karty (ta je mezi
    // vycpávkami nahoře, originál dole) — teprve pak má smysl ověřovat, že
    // klik na odkaz pohled zase posune zpátky.
    const versionLink = originalRow.getByRole('button', { name: 'těžší' })
    await versionLink.scrollIntoViewIfNeeded()
    await expect(versionLink).toBeVisible()
    await expect(newRow).not.toBeInViewport()

    await versionLink.click()
    // Zvýraznění se objeví hned po kliknutí (ještě během plynulého posunu)
    // a samo zase zmizí — karta nezůstane rozsvícená napořád.
    await expect(newRow).toHaveClass(/bg-brand-bg/)
    await expect(newRow).toBeInViewport()
    await expect(newRow).not.toHaveClass(/bg-brand-bg/, { timeout: 3_000 })

    // I karta verze sama ukazuje řádek zpátky na svůj kořen.
    await expect(newRow.getByRole('button', { name: 'lehčí' })).toBeVisible()
  })
})

/**
 * Lehčí/těžší verze celé písemky (skladač, `/tests/[id]`) — tlačítko
 * v hlavičce. Model se nevolá, `/api/tests/variant` je podvržený NDJSON
 * stream (`page.route`), stejně jako u verze jedné otázky výš v souboru.
 */
test.describe('verze písemky ve skladači', () => {
  async function createTest(request: APIRequestContext, title: string): Promise<string> {
    const bank = await request.get('/api/questions?status=approved&limit=1')
    expect(bank.ok()).toBe(true)
    const { items } = (await bank.json()) as { items: { id: string }[] }
    expect(items.length, 'v knihovně nejsou schválené otázky').toBeGreaterThan(0)

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
    expect(created.ok(), 'zkušební test se nepodařilo založit').toBe(true)
    const { id } = (await created.json()) as { id: string }
    return id
  }

  /** Podvrhne NDJSON stream `/api/tests/variant`: start → progress → done, s novým id. */
  async function mockTestVariant(page: Page, newTestId: string): Promise<void> {
    await page.route('**/api/tests/variant', async (route) => {
      const events = [
        { type: 'start', total: 1 },
        { type: 'progress', done: 1, total: 1 },
        { type: 'done', testId: newTestId, replaced: 0, generated: 1, kept: 0 },
      ]
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: events.map((event) => JSON.stringify(event)).join('\n') + '\n',
      })
    })
  }

  test('tlačítko s podvrženým streamem otevře novou písemku', async ({ page }) => {
    const title = `E2E verze písemky ${Date.now()}`
    const testId = await createTest(page.request, title)
    const novaId = await createTest(page.request, `${title} – cíl přesměrování`)
    await mockTestVariant(page, novaId)

    await page.goto(`/tests/${testId}`)
    await page.getByRole('button', { name: 'Verze písemky' }).click()
    await page.getByRole('menuitem', { name: 'Lehčí verze písemky' }).click()

    await expect(page).toHaveURL(new RegExp(`/tests/${novaId}$`))
    await expect(page.getByText('Lehčí verze písemky je hotová.')).toBeVisible()
  })

  test('neuložené změny nabídnou uložení místo požadavku', async ({ page }) => {
    const title = `E2E neuložená verze ${Date.now()}`
    const testId = await createTest(page.request, title)
    let dotazu = 0
    await page.route('**/api/tests/variant', async (route) => {
      dotazu += 1
      await route.abort()
    })

    await page.goto(`/tests/${testId}`)
    // Rozdělá se neuložená změna — přejmenování názvu bez uložení. Píše se
    // po znacích (`pressSequentially`) do vybraného textu, ne `.fill()`: to
    // ve webkitu na téhle stránce (test s položkou, tedy s `SortableContext`
    // z dnd-kit) nastaví hodnotu, aniž by se React dozvěděl o změně přes
    // `onChange`.
    const upraveny = `${title} (upraveno)`
    const titleInput = page.getByLabel('Název písemky')
    await titleInput.selectText()
    await titleInput.pressSequentially(upraveny)
    await expect(titleInput).toHaveValue(upraveny)

    await page.getByRole('button', { name: 'Verze písemky' }).click()
    await page.getByRole('menuitem', { name: 'Těžší verze písemky' }).click()

    await expect(page.getByText(/Nejdřív ulož písemku/)).toBeVisible()
    expect(dotazu).toBe(0)
  })
})
