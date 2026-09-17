import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Kontrola konceptů a vrácení hromadné akce.
 *
 * Testy si zakládají vlastní téma s otázkami ve dvou stavech: část je koncept,
 * část už je schválená. Na začátku každého běhu se stavy nastaví znovu, takže
 * test nezávisí na tom, co po sobě nechal běh předchozí (a projde stejně
 * v chromiu i ve WebKitu, které běží za sebou nad touž databází).
 */

const SUBJECT = 'E2E KONTROLA'
const GRADE = 'E2E fronta'
const TOPIC = 'Fronta konceptů'

/** Text materiálu musí být dost dlouhý, aby téma nebylo označené jako „málo obsahu“. */
const TEXT =
  'Koloběh vody v přírodě zahrnuje výpar, vznik oblaků, srážky a odtok vody zpět do moří a oceánů. '.repeat(
    12,
  )

/** Otázky, které se mají v tématu objevit. Podle textu se pozná, co je koncept. */
const PREPARED = [
  { prompt: 'Koncept ke kontrole 1: kde se voda vypařuje?', draft: true },
  { prompt: 'Koncept ke kontrole 2: co vzniká ochlazením páry?', draft: true },
  { prompt: 'Už schválená otázka 1: kam voda odtéká?', draft: false },
  { prompt: 'Už schválená otázka 2: čím je poháněn koloběh vody?', draft: false },
] as const

const DRAFT_COUNT = PREPARED.filter((item) => item.draft).length

test.describe('kontrola konceptů', () => {
  test('fronta nabídne jen koncepty, ne to, co je už schválené', async ({ page }) => {
    await page.goto(await prepareTopic(page))

    // Do fronty jdou jen koncepty, i když v tématu jsou i schválené otázky.
    const queueButton = page.getByRole('button', { name: 'Projít po jedné' })
    await expect(queueButton).toHaveText(`Projít po jedné (${DRAFT_COUNT})`)
    await queueButton.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Kontrola konceptů')

    // Projdeme frontu celou a ověříme, že v ní nepotkáme schválenou otázku.
    for (let position = 1; position <= DRAFT_COUNT; position += 1) {
      await expect(dialog).toContainText(`Zbývá ke kontrole ${DRAFT_COUNT - position + 1}`)
      await expect(dialog).toContainText('Koncept ke kontrole')
      await expect(dialog).not.toContainText('Už schválená otázka')
      await dialog.getByRole('button', { name: 'Přeskočit' }).click()
    }

    // Po poslední otázce se fronta zavře sama.
    await expect(dialog).toHaveCount(0)
  })

  test('hromadné zamítnutí ohlásí hláškou a dá se vzít zpět', async ({ page }) => {
    await page.goto(await prepareTopic(page))

    const queueButton = page.getByRole('button', { name: 'Projít po jedné' })
    await expect(queueButton).toHaveText(`Projít po jedné (${DRAFT_COUNT})`)

    await page.getByRole('checkbox', { name: 'Vybrat vše' }).click()
    await page.getByRole('button', { name: 'Zamítnout' }).click()

    // Hláška řekne, co se stalo, a nabídne vrácení.
    const toast = page.getByText(/^Zamítnuto: \d+ otáz/)
    await expect(toast).toBeVisible()
    const undo = page.getByRole('button', { name: 'Vzít zpět' })
    await expect(undo).toBeVisible()

    // Všechny otázky jsou zamítnuté, takže ve frontě konceptů nezbylo nic.
    await expect(queueButton).toHaveText('Projít po jedné (0)')
    await expect(queueButton).toBeDisabled()

    await undo.click()
    await expect(page.getByText(/^Vráceno zpět/)).toBeVisible()

    // Otázky mají zase své původní stavy: koncepty jsou zpátky koncepty
    // a schválené zůstaly schválené (jinak by jich fronta nabídla víc).
    await expect(queueButton).toHaveText(`Projít po jedné (${DRAFT_COUNT})`, { timeout: 15000 })
    await expect(queueButton).toBeEnabled()
  })

  test('hláška i lišta hromadných akcí jsou čitelné ve světlém i tmavém režimu', async ({ page }) => {
    await page.goto(await prepareTopic(page))

    for (const motiv of ['svetla', 'tmava'] as const) {
      if (motiv === 'tmava') {
        await page.getByRole('button', { name: 'Tmavý motiv' }).click()
        await expect(page.locator('html')).toHaveClass(/dark/)
      }

      // Lišta hromadných akcí — na snímku je vidět i červené tlačítko „Smazat“.
      await page.getByRole('checkbox', { name: 'Vybrat vše' }).click()
      await expect(page.getByRole('button', { name: /^Smazat \(\d+\)$/ })).toBeVisible()
      await page.screenshot({ path: `e2e/screenshots/hromadne-akce-${motiv}.png`, fullPage: false })

      await page.getByRole('button', { name: 'Schválit' }).click()
      // Hlášek může být na hromádce víc (z předchozího průchodu ještě nezmizela),
      // proto `.first()` — jde o to, že se hláška ukázala, ne kolikátá je.
      await expect(page.getByText(/^Schváleno: \d+ otáz/).first()).toBeVisible()
      // Krátká pauza, ať se hláška dosune na místo a není na snímku useknutá.
      await page.waitForTimeout(500)
      await page.screenshot({ path: `e2e/screenshots/hlaska-${motiv}.png`, fullPage: false })

      // Hláška nesmí překrývat ovládání: „Vzít zpět“ i lišta zůstávají klikatelné.
      await page.getByRole('button', { name: 'Vzít zpět' }).first().click()
      await expect(page.getByText(/^Vráceno zpět/).first()).toBeVisible()
    }

    // Motiv se vrátí zpátky, ať další test nezačíná potmě.
    await page.getByRole('button', { name: 'Podle systému' }).click()
  })
})

/**
 * Založí (nebo najde) zkušební téma, doplní do něj otázky a nastaví jim
 * stavy podle `PREPARED`. Vrací cestu `/topics/<id>`.
 */
async function prepareTopic(page: Page): Promise<string> {
  const topicId = await ensureTopic(page.request)
  await ensureQuestions(page.request, topicId)
  await resetStatuses(page, topicId)
  return `/topics/${topicId}`
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
          contentHash: 'e2e-fronta-konceptu-v1',
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

/** Doplní otázky, pokud v tématu ještě nejsou. Stavy se řeší až v `resetStatuses`. */
async function ensureQuestions(request: APIRequestContext, topicId: string): Promise<void> {
  const impact = await request.get(`/api/library?kind=topic&id=${encodeURIComponent(topicId)}`)
  expect(impact.ok()).toBe(true)
  const { questions } = (await impact.json()) as { questions: number }
  if (questions >= PREPARED.length) return

  for (const { prompt } of PREPARED.slice(questions)) {
    const created = await request.post('/api/questions', {
      data: {
        topicId,
        question: {
          type: 'short_answer',
          difficulty: 1,
          points: 1,
          blocks: [],
          payload: { prompt, answer: 'voda', acceptedAnswers: [] },
        },
      },
    })
    expect(created.ok(), 'zkušební otázku se nepodařilo založit').toBe(true)
  }
}

/**
 * Vrátí otázky do výchozích stavů. Id se čtou ze seznamu na stránce — jiná
 * cesta k nim nevede a natvrdo zapsaná id by na cizí databázi neexistovala.
 */
async function resetStatuses(page: Page, topicId: string): Promise<void> {
  await page.goto(`/topics/${topicId}`)
  const rows = page.locator('li[data-question-id]')
  await expect(rows).toHaveCount(PREPARED.length)

  const drafts: string[] = []
  const approved: string[] = []
  for (const row of await rows.all()) {
    const id = await row.getAttribute('data-question-id')
    const text = (await row.textContent()) ?? ''
    if (!id) continue
    if (text.includes('Koncept ke kontrole')) drafts.push(id)
    else approved.push(id)
  }
  expect(drafts).toHaveLength(DRAFT_COUNT)

  for (const [ids, status] of [
    [drafts, 'draft'],
    [approved, 'approved'],
  ] as const) {
    if (ids.length === 0) continue
    const response = await page.request.put('/api/questions', { data: { ids, status } })
    expect(response.ok(), 'stav zkušebních otázek se nepodařilo nastavit').toBe(true)
  }
}
