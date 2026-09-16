import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Obrazovka kontroly konceptů přes celou knihovnu (`/review`).
 *
 * Fronta se ovládá klávesami a načítá se po stránkách — zkušební téma má proto
 * schválně víc otázek, než se vejde do jedné stránky, aby bylo vidět, že přes
 * hranici přejde sama a učitelka o ničem neví.
 *
 * Testy si data zakládají samy a před každým během je vracejí do výchozího
 * stavu, takže nezáleží na tom, co po sobě nechal běh předchozí (a projdou
 * v chromiu i ve WebKitu, které běží za sebou nad touž databází).
 */

const SUBJECT = 'E2E KONTROLA'
const GRADE = 'E2E fronta knihovny'
const TOPIC = 'Fronta přes stránky'

/** Text materiálu musí být dost dlouhý, aby téma nebylo označené jako „málo obsahu“. */
const TEXT =
  'Podnebné pásy se liší množstvím srážek, teplotou i délkou dne během roku. '.repeat(14)

/**
 * Otázek je víc, než kolik jich fronta natáhne jednou stránkou (20) — jinak
 * by se přechod přes hranici stránky vůbec nekonal.
 */
const COUNT = 25
/** Velikost stránky fronty; po tolika schváleních musí být fronta pořád plná. */
const PAGE_SIZE = 20

test.describe('kontrola konceptů přes celou knihovnu', () => {
  test('fronta se ovládá klávesami a přejde přes hranici stránky bez zásahu', async ({ page }) => {
    const topicId = await prepareTopic(page)
    await page.goto(`/review?topicId=${topicId}`)

    const queue = page.locator('[data-review-queue]')
    await expect(queue).toContainText(`Schváleno 0 · zbývá ${COUNT}`)

    // První stránka: schválíme jich přesně tolik, kolik se jich vejde do
    // jedné dávky. Kdyby se další nedotáhla, fronta by tu skončila.
    for (let done = 1; done <= PAGE_SIZE; done += 1) {
      await page.keyboard.press('a')
      await expect(queue).toContainText(`Schváleno ${done} · zbývá ${COUNT - done}`)
    }

    // Za hranicí stránky pořád stojí otázka a dá se schvalovat dál.
    await expect(queue.getByRole('button', { name: /^Schválit/ })).toBeVisible()

    for (let done = PAGE_SIZE + 1; done < COUNT; done += 1) {
      await page.keyboard.press('a')
      await expect(queue).toContainText(`Schváleno ${done} · zbývá ${COUNT - done}`)
    }

    // Poslední otázkou fronta došla a řekne to — i s tím, co se stihlo.
    await page.keyboard.press('a')
    await expect(queue).toContainText('Hotovo, fronta je prázdná')
    await expect(queue).toContainText(`schválila ${COUNT} otázek`)

    // A schválení se opravdu zapsalo — v tématu nezbyl jediný koncept.
    expect(await draftCount(page.request, topicId)).toBe(0)
  })

  test('zamítnutí i přeskočení fronty ubírají ze zbývajících jen to, co odbavila', async ({ page }) => {
    const topicId = await prepareTopic(page)
    await page.goto(`/review?topicId=${topicId}`)

    const queue = page.locator('[data-review-queue]')
    await expect(queue).toContainText(`Schváleno 0 · zbývá ${COUNT}`)

    // Přeskočení nic nemění — otázka zůstává ve frontě na jindy.
    await page.keyboard.press('ArrowRight')
    await expect(queue).toContainText(`Schváleno 0 · zbývá ${COUNT}`)

    // Zamítnutí ubere ze zbývajících, ale mezi schválené se nepočítá.
    await page.keyboard.press('x')
    await expect(queue).toContainText(`Schváleno 0 · zbývá ${COUNT - 1}`)

    await page.keyboard.press('a')
    await expect(queue).toContainText(`Schváleno 1 · zbývá ${COUNT - 2}`)

    expect(await draftCount(page.request, topicId)).toBe(COUNT - 2)
  })

  test('„Schválit celé téma“ odbaví zbytek jedním kliknutím a dá se vzít zpět', async ({ page }) => {
    const topicId = await prepareTopic(page)
    await page.goto(`/review?topicId=${topicId}`)

    const queue = page.locator('[data-review-queue]')
    await expect(queue).toContainText(`Schváleno 0 · zbývá ${COUNT}`)

    await page.getByRole('button', { name: 'Schválit celé téma' }).click()

    const toast = page.getByText(/^Schváleno \d+ otáz\w+ v tématu/)
    await expect(toast).toBeVisible()
    expect(await draftCount(page.request, topicId)).toBe(0)

    await page.getByRole('button', { name: 'Vzít zpět' }).click()
    await expect(page.getByText(/^Vráceno zpět/)).toBeVisible()

    // Koncepty jsou zpátky ve frontě.
    await expect
      .poll(() => draftCount(page.request, topicId), { timeout: 15000 })
      .toBe(COUNT)
  })
})

/** Založí (nebo najde) zkušební téma, doplní otázky a vrátí všem stav „koncept“. */
async function prepareTopic(page: Page): Promise<string> {
  const topicId = await ensureTopic(page.request)
  await ensureQuestions(page.request, topicId)
  await resetToDrafts(page.request, topicId)
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
          contentHash: 'e2e-fronta-pres-stranky-v1',
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

/** Doplní otázky do počtu `COUNT`. Stavy se srovnají až v `resetToDrafts`. */
async function ensureQuestions(request: APIRequestContext, topicId: string): Promise<void> {
  const existing = await questionCount(request, topicId)
  for (let index = existing; index < COUNT; index += 1) {
    const created = await request.post('/api/questions', {
      data: {
        topicId,
        question: {
          type: 'short_answer',
          difficulty: 1,
          points: 1,
          blocks: [],
          payload: { prompt: `Koncept ${index + 1}: čím se liší podnebné pásy?`, answer: 'srážkami' },
        },
      },
    })
    expect(created.ok(), 'zkušební otázku se nepodařilo založit').toBe(true)
  }
}

/** Vrátí všechny otázky tématu do stavu „koncept“ — hromadnou akcí podle tématu. */
async function resetToDrafts(request: APIRequestContext, topicId: string): Promise<void> {
  for (const from of ['approved', 'rejected'] as const) {
    const response = await request.put('/api/questions', { data: { topicId, from, status: 'draft' } })
    expect(response.ok(), 'stav zkušebních otázek se nepodařilo nastavit').toBe(true)
  }
  expect(await draftCount(request, topicId)).toBe(COUNT)
}

/** Kolik konceptů v tématu čeká. */
async function draftCount(request: APIRequestContext, topicId: string): Promise<number> {
  const response = await request.get(`/api/questions?status=draft&limit=1&topicId=${topicId}`)
  expect(response.ok()).toBe(true)
  const { total } = (await response.json()) as { total: number }
  return total
}

/** Kolik otázek téma má dohromady, bez ohledu na stav. */
async function questionCount(request: APIRequestContext, topicId: string): Promise<number> {
  const response = await request.get(`/api/questions?limit=1&topicId=${topicId}`)
  expect(response.ok()).toBe(true)
  const { total } = (await response.json()) as { total: number }
  return total
}
