import { expect, test, type APIRequestContext } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Generování otázek v tématu: karta ukazuje jen tlačítko, počet a obtížnost —
 * bez výběru typů a bez režimu „Doplnit na celkový počet" (ten je jen pro
 * hromadné generování). Vynechaný (nebo chybějící) materiál generování vypne
 * s vysvětlením a téma úplně bez obsahu nabídne prázdný stav se dvěma cestami.
 */

const SUBJECT = 'E2E GENEROVANI'
const GRADE = 'E2E generování'

const TEXT =
  'Koloběh látek v přírodě propojuje živé organismy s neživým prostředím prostřednictvím výměny látek a energie. '.repeat(
    12,
  )

/** Založí zkušební téma s jedním materiálem a vrátí jeho id. */
async function ensureTopicWithMaterial(request: APIRequestContext, topic: string): Promise<string> {
  const imported = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: `${SUBJECT}/${GRADE}/${topic}.txt`,
          fileName: `${topic}.txt`,
          subject: SUBJECT,
          grade: GRADE,
          topic,
          mimeType: 'text/plain',
          sizeBytes: TEXT.length,
          text: TEXT,
          pageCount: null,
          needsOcr: false,
          contentHash: `e2e-generovani-v1:${topic}`,
        },
      ],
    },
  })
  expect(imported.ok(), 'zkušební materiál se nepodařilo naimportovat').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(topic)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const found2 = results.find((result) => result.topicName.includes(topic))
  expect(found2, `zkušební téma „${topic}“ se v knihovně nenašlo`).toBeTruthy()
  return found2!.topicId
}

/**
 * Založí prázdné téma (bez materiálů, bez otázek) ručně přes knihovnu, ne
 * přes import materiálu — přesně cesta, kterou si založí učitelka, co chce
 * psát otázky sama. Předmět i ročník jsou pokaždé nové (jméno s časem), ať
 * se běhy testu nepletou do stejné položky a nemusí se řešit už existující.
 */
async function ensureEmptyTopic(request: APIRequestContext, name: string): Promise<string> {
  const subject = await request.post('/api/library', {
    data: { kind: 'subject', name: `${SUBJECT} prázdné ${Date.now()}` },
  })
  expect(subject.ok(), 'zkušební předmět se nepodařilo založit').toBe(true)
  const { id: subjectId } = (await subject.json()) as { id: string }

  const grade = await request.post('/api/library', {
    data: { kind: 'grade', name: `${GRADE} prázdné ${Date.now()}`, parentId: subjectId },
  })
  expect(grade.ok(), 'zkušební ročník se nepodařilo založit').toBe(true)
  const { id: gradeId } = (await grade.json()) as { id: string }

  const created = await request.post('/api/library', {
    data: { kind: 'topic', name, parentId: gradeId },
  })
  expect(created.ok(), 'zkušební téma se nepodařilo založit').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

test.describe('generování otázek v tématu', () => {
  test('karta ukazuje jen počet a obtížnost, výchozí počet je 10', async ({ page, request }) => {
    const path = await testTopicPath(request)
    await page.goto(path)

    const generate = page.getByRole('button', { name: 'Vygenerovat otázky' })
    test.skip((await generate.count()) === 0, 'Generování není nakonfigurované.')

    // Žádný výběr typů ani režim doplnění — ty patří jen hromadnému generování.
    await expect(page.getByRole('button', { name: 'Nastavení generování' })).toHaveCount(0)
    await expect(page.getByText('Počet otázek znamená')).toHaveCount(0)
    await expect(page.getByText('Typy otázek')).toHaveCount(0)

    // `#generate-difficulty`, ne obecný popisek — filtr otázek pod tím má
    // stejně pojmenovanou obtížnost.
    const difficulty = page.locator('#generate-difficulty')
    await expect(page.getByLabel('Počet', { exact: true })).toHaveValue('10')
    await expect(difficulty).toHaveText('Promíchat')
    await expect(page.getByText(/^Vznikne 10 otázek z 1 materiálu\.$/)).toBeVisible()

    await page.getByLabel('Počet', { exact: true }).fill('3')
    await expect(page.getByText(/^Vznikne 3 otázky z 1 materiálu\.$/)).toBeVisible()

    await difficulty.click()
    await page.getByRole('option', { name: 'Těžké' }).click()
    await expect(difficulty).toHaveText('Těžké')
  })

  test('vynechaný jediný materiál vypne generování s vysvětlením', async ({ page, request }) => {
    // Přípona čistě z číslic se při seskupování podobných názvů témat
    // nepočítá (`topicTokens` v `packages/core/src/extract/grouping.ts`
    // číselné tokeny zahazuje) — `toString(36)` dá do přípony i písmena, ať
    // dva běhy tohohle testu nesplynou do jednoho tématu s víc materiály.
    const topicId = await ensureTopicWithMaterial(request, `Vynechaný materiál ${Date.now().toString(36)}`)
    await page.goto(`/topics/${topicId}`)

    const generate = page.getByRole('button', { name: 'Vygenerovat otázky' })
    test.skip((await generate.count()) === 0, 'Generování není nakonfigurované.')
    await expect(generate).toBeEnabled()

    const stripHeader = page.getByRole('button', { name: /^Materiály/ })
    if ((await stripHeader.getAttribute('aria-expanded')) !== 'true') await stripHeader.click()
    const materialId = await page.locator('[data-material-id]').first().getAttribute('data-material-id')
    expect(materialId, 'id materiálu se ze stránky nepodařilo přečíst').toBeTruthy()

    const excluded = await request.patch('/api/materials', { data: { id: materialId, excluded: true } })
    expect(excluded.ok()).toBe(true)
    await page.reload()

    await expect(page.getByRole('button', { name: 'Vygenerovat otázky' })).toBeDisabled()
    await expect(page.getByText('Nejdřív nahraj materiál nebo ho zapni pro generování.')).toBeVisible()
  })

  test('prázdné téma nabídne nahrání materiálu i napsání otázky', async ({ page, request }) => {
    const topicId = await ensureEmptyTopic(request, `Prázdné téma nahrání ${Date.now()}`)
    await page.goto(`/topics/${topicId}`)

    await expect(page.getByText('Téma je zatím prázdné.')).toBeVisible()
    // Karta generování ani pruh materiálů se v prázdném tématu neukazují —
    // jen jednotná výzva s oběma cestami.
    await expect(page.getByRole('button', { name: 'Vygenerovat otázky' })).toHaveCount(0)

    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Nahrát materiál' }).click()
    const chooser = await chooserPromise
    await chooser.setFiles({
      name: 'Nahraný z prázdného tématu.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(TEXT, 'utf8'),
    })

    await expect(page.getByText(/Nahráno 1 materiál/)).toBeVisible()
    await expect(page.getByText('Téma je zatím prázdné.')).toHaveCount(0)
    await expect(page.getByText('Nahraný z prázdného tématu.txt')).toBeVisible()
  })

  test('prázdné téma: napsání otázky otevře formulář rovnou', async ({ page, request }) => {
    const topicId = await ensureEmptyTopic(request, `Prázdné téma otázka ${Date.now()}`)
    await page.goto(`/topics/${topicId}`)

    await expect(page.getByText('Téma je zatím prázdné.')).toBeVisible()
    await page.getByRole('button', { name: 'Napsat otázku' }).click()

    const form = page.getByTestId('new-question-form')
    await expect(form).toBeVisible()
    const prompt = `Otázka z prázdného tématu ${Date.now()}`
    await form.getByLabel('Typ').click()
    await page.getByRole('option', { name: 'Krátká odpověď' }).click()
    await form.getByLabel('Zadání').fill(prompt)
    await form.getByLabel('Správná odpověď').fill('odpověď')
    await form.getByRole('button', { name: 'Uložit' }).click()

    await expect(page.getByText('Téma je zatím prázdné.')).toHaveCount(0)
    await expect(page.locator('li[data-question-id]', { hasText: prompt })).toBeVisible()
  })
})
