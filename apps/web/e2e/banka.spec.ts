import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Banka otázek: hledání a filtry v adrese, hromadné akce a úprava otázky
 * rovnou z řádku.
 *
 * Test si zakládá vlastní téma s otázkami a na začátku každého běhu jim vrací
 * výchozí stavy — nezávisí tedy na tom, co po sobě nechal běh předchozí
 * (v chromiu i ve WebKitu, které jedou za sebou nad touž databází).
 */

const SUBJECT = 'E2E BANKA'
const GRADE = 'E2E banka'
const TOPIC = 'Sopky a zemětřesení'

/** Text materiálu musí být dost dlouhý, aby téma nebylo označené jako „málo obsahu“. */
const TEXT =
  'Sopka je místo, kde na povrch vystupuje magma; po výlevu se z něj stává láva a vzniká sopečný kužel. '.repeat(
    12,
  )

/**
 * Zkušební otázky. Slovo „sopečný“ má jen část z nich — podle toho se pozná,
 * že hledání opravdu zúžilo seznam, a ne že se jen něco překreslilo.
 */
const PREPARED = [
  { prompt: 'Sopečný popel: kam až doletí?', draft: true },
  { prompt: 'Sopečný kužel vzniká z čeho?', draft: true },
  { prompt: 'Zemětřesení se měří čím?', draft: false },
  { prompt: 'Kde leží nejvíc sopek?', draft: false },
] as const

const DRAFT_COUNT = PREPARED.filter((item) => item.draft).length
const SOPECNY_COUNT = PREPARED.filter((item) => item.prompt.startsWith('Sopečný')).length

test.describe('banka otázek', () => {
  test('hledání i filtry se vyřídí na serveru a zůstanou v adrese', async ({ page }) => {
    const topicId = await prepareTopic(page)
    await page.goto(`/questions?topicId=${topicId}`)

    const rows = page.locator('tr[data-question-id]')
    await expect(rows).toHaveCount(PREPARED.length)

    // Hledání se do adresy propisuje se zpožděním; psaní se opakuje, dokud se
    // neprojeví — ve WebKitu se stane, že text padne do políčka dřív, než se
    // stránka v prohlížeči oživí, a React se o něm nedozví. Políčko se před
    // každým pokusem vyprázdní, jinak by druhé vyplnění touž hodnotou žádnou
    // událost nevyvolalo.
    await expect(async () => {
      await page.getByLabel('Hledat').fill('')
      await page.getByLabel('Hledat').fill('sopečný')
      await expect(page).toHaveURL(/q=sope/, { timeout: 3000 })
    }).toPass({ timeout: 20_000 })
    await expect(rows).toHaveCount(SOPECNY_COUNT)

    // Odkaz se dá poslat a otevřít znovu — filtry se z adresy obnoví.
    const url = page.url()
    await page.goto('/questions')
    await page.goto(url)
    await expect(page.getByLabel('Hledat')).toHaveValue('sopečný')
    await expect(rows).toHaveCount(SOPECNY_COUNT)

    // Filtr stavu se s hledáním skládá: koncepty se slovem „sopečný“.
    await page.goto(`/questions?topicId=${topicId}&q=sope%C4%8Dn%C3%BD&status=draft`)
    await expect(rows).toHaveCount(DRAFT_COUNT)
    await expect(page.getByText('koncept').first()).toBeVisible()
  })

  test('hromadné schválení ohlásí hláškou a dá se vzít zpět', async ({ page }) => {
    const topicId = await prepareTopic(page)
    await page.goto(`/questions?topicId=${topicId}&status=draft`)

    const rows = page.locator('tr[data-question-id]')
    await expect(rows).toHaveCount(DRAFT_COUNT)

    await page.getByRole('checkbox', { name: /^Vybrat vše viditelné/ }).click()
    await expect(page.getByText(`Vybráno ${DRAFT_COUNT}`)).toBeVisible()
    await page.getByRole('button', { name: 'Schválit' }).click()

    await expect(page.getByText(/^Schváleno: \d+ otáz/).first()).toBeVisible()
    // Schválené otázky z filtru konceptů vypadly, takže tabulka je prázdná.
    await expect(rows).toHaveCount(0)
    await expect(page.getByText('Filtru nic neodpovídá')).toBeVisible()

    await page.getByRole('button', { name: 'Vzít zpět' }).first().click()
    await expect(page.getByText(/^Vráceno zpět/).first()).toBeVisible()
    await expect(rows).toHaveCount(DRAFT_COUNT, { timeout: 15000 })
  })

  test('vybranou otázku jde z banky smazat a smazání jde vrátit zpět', async ({ page }) => {
    const topicId = await prepareTopic(page)
    // Vlastní otázka jen pro tenhle běh — ostatní zkušební otázky musí zůstat.
    const prompt = `Na smazání ${Date.now()}`
    await createQuestion(page.request, topicId, prompt)

    await page.goto(`/questions?topicId=${topicId}&q=${encodeURIComponent('na smazání')}`)
    const rows = page.locator('tr[data-question-id]')
    await expect(rows).toHaveCount(1)

    await page.getByRole('checkbox', { name: `Vybrat otázku ${prompt}` }).click()
    // Číslo je v liště jen jednou („Vybráno 1“), tlačítko ho neopakuje.
    await expect(page.getByText('Vybráno 1')).toBeVisible()
    await page.getByRole('button', { name: 'Smazat', exact: true }).click()
    // Smazání je jen změna stavu, ne mizení z uloženého testu — potvrzení to
    // musí říkat, ne strašit ztrátou z písemky.
    await expect(page.getByRole('alertdialog').getByText(/Uložené testy je vytisknou dál/)).toBeVisible()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Smazat' }).click()

    await expect(page.getByText(/^Smazáno: 1 otázka/)).toBeVisible()
    // Smazání je jen změna stavu na „zamítnuto“ — řádek beze stavového filtru
    // zůstává v seznamu, jen s jiným popiskem stavu.
    await expect(rows).toHaveCount(1, { timeout: 15000 })
    await expect(rows.getByText('zamítnuto')).toBeVisible()

    await page.getByRole('button', { name: 'Vrátit zpět' }).click()
    await expect(page.getByText(/^Vráceno zpět: 1 otázka/)).toBeVisible()
    await expect(rows.getByText('schváleno')).toBeVisible({ timeout: 15000 })
  })

  test('otázka se dá upravit rovnou z řádku banky', async ({ page }) => {
    const topicId = await prepareTopic(page)
    const prompt = `Na úpravu ${Date.now()}`
    await createQuestion(page.request, topicId, prompt)

    await page.goto(`/questions?topicId=${topicId}&q=${encodeURIComponent('na úpravu')}`)
    const rows = page.locator('tr[data-question-id]')
    await expect(rows).toHaveCount(1)

    // Akce u řádku jsou v nabídce pod třemi tečkami — týž vzor jako u testů.
    await rows.getByRole('button', { name: /^Akce u otázky/ }).click()
    await page.getByRole('menuitem', { name: 'Upravit' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const upraveny = `${prompt} — upraveno`
    await dialog.getByLabel('Zadání').fill(upraveny)
    await dialog.getByRole('button', { name: 'Uložit' }).click()

    await expect(dialog).toHaveCount(0)
    await expect(page.getByText(upraveny)).toBeVisible({ timeout: 15000 })
  })
})

/**
 * Založí (nebo najde) zkušební téma, doplní do něj otázky a nastaví jim
 * výchozí stavy. Vrací id tématu.
 */
async function prepareTopic(page: Page): Promise<string> {
  const topicId = await ensureTopic(page.request)
  await ensureQuestions(page.request, topicId)
  await resetStatuses(page, topicId)
  return topicId
}

/** Importuje zkušební materiál (opakovaně tentýž) a vrátí id jeho tématu. */
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
          // Pevný otisk obsahu: při dalším běhu se materiál pozná jako už známý.
          contentHash: 'e2e-banka-otazek-v1',
        },
      ],
    },
  })
  expect(imported.ok(), 'zkušební materiál se nepodařilo naimportovat').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(TOPIC)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const topic = results.find((result) => result.topicName.includes(TOPIC))
  expect(topic, `zkušební téma „${TOPIC}“ se v knihovně nenašlo`).toBeTruthy()
  return topic!.topicId
}

/** Vlastní otázka se zadaným zněním. */
async function createQuestion(
  request: APIRequestContext,
  topicId: string,
  prompt: string,
): Promise<void> {
  const created = await request.post('/api/questions', {
    data: {
      topicId,
      question: {
        type: 'short_answer',
        difficulty: 1,
        points: 1,
        blocks: [],
        payload: { prompt, answer: 'láva', acceptedAnswers: [] },
      },
    },
  })
  expect(created.ok(), 'zkušební otázku se nepodařilo založit').toBe(true)
}

/** Doplní zkušební otázky, pokud v tématu ještě nejsou. */
async function ensureQuestions(request: APIRequestContext, topicId: string): Promise<void> {
  for (const { prompt } of PREPARED) {
    const found = await request.get(
      `/api/questions?topicId=${encodeURIComponent(topicId)}&q=${encodeURIComponent(prompt)}`,
    )
    expect(found.ok()).toBe(true)
    const { total } = (await found.json()) as { total: number }
    if (total === 0) await createQuestion(request, topicId, prompt)
  }
}

/**
 * Vrátí zkušební otázky do výchozích stavů a uklidí, co v tématu zbylo
 * z předchozích běhů (smazané a upravené otázky).
 */
async function resetStatuses(page: Page, topicId: string): Promise<void> {
  const response = await page.request.get(
    `/api/questions?topicId=${encodeURIComponent(topicId)}&limit=200`,
  )
  expect(response.ok()).toBe(true)
  const { items } = (await response.json()) as { items: { id: string; payload: { prompt?: string } }[] }

  const drafts: string[] = []
  const approved: string[] = []
  const navic: string[] = []
  for (const item of items) {
    const prompt = item.payload.prompt ?? ''
    const prepared = PREPARED.find((row) => row.prompt === prompt)
    if (!prepared) navic.push(item.id)
    else if (prepared.draft) drafts.push(item.id)
    else approved.push(item.id)
  }

  for (const [ids, status] of [
    [drafts, 'draft'],
    [approved, 'approved'],
  ] as const) {
    if (ids.length === 0) continue
    const put = await page.request.put('/api/questions', { data: { ids, status } })
    expect(put.ok(), 'stav zkušebních otázek se nepodařilo nastavit').toBe(true)
  }

  // Otázky z předchozích běhů (na smazání, na úpravu) by pletly počty.
  if (navic.length > 0) {
    const query = navic.map((id) => `id=${encodeURIComponent(id)}`).join('&')
    const removed = await page.request.delete(`/api/questions?${query}`)
    expect(removed.ok(), 'zbytky z předchozího běhu se nepodařilo uklidit').toBe(true)
  }
}
