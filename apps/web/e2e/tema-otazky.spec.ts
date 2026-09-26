import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Otázky v tématu jako karty: úprava přímo v seznamu, přegenerování, smazání
 * s možností vrácení a filtr.
 *
 * Čtení bez práv u role `nahled` je v `role.spec.ts` — tenhle soubor běží
 * bez přihlašování (port 3100), kde roli přepnout nejde; scénář pro `nahled`
 * potřebuje přihlašovací konfiguraci (port 3101), stejně jako zbytek toho
 * souboru.
 *
 * Kontrola konceptů (`kontrola.spec.ts`) mizí — tenhle soubor ji nenahrazuje,
 * protože fronta ke schválení v tématu končí; otázky se tu jen upravují,
 * mažou a přegenerovávají přímo v kartách.
 *
 * Vlastní zkušební téma (ne `testTopicPath` z `fixtures.ts`): tamní téma sdílí
 * i `generovani.spec.ts`, který počítá s pevným počtem otázek — přibývající
 * otázky z tohohle souboru by mu tenhle počet rozbily.
 */

const SUBJECT = 'E2E KONTROLA'
const GRADE = 'E2E otázky tématu'
const TOPIC = 'Otázky v tématu jako karty'

/** Text materiálu musí být dost dlouhý, aby téma nebylo označené jako „málo obsahu“. */
const TEXT =
  'Koloběh látek v přírodě propojuje živé organismy s neživým prostředím prostřednictvím výměny látek a energie. '.repeat(
    12,
  )

/**
 * Založí (nebo najde) zkušební téma jen pro tenhle soubor. Vrací jeho id.
 *
 * `topic` jde přepsat — test na téma se všemi smazanými otázkami potřebuje
 * vlastní, izolované téma, ať mu ho nezalidní otázky z ostatních testů
 * v tomhle souboru (ty sdílejí `TOPIC` a nikdy nekončí úplně bez otázek).
 */
async function ensureTopic(request: APIRequestContext, topic: string = TOPIC): Promise<string> {
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
          contentHash: `e2e-tema-otazky-v1:${topic}`,
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

/** Založí unikátní otázku a vrátí její id. */
async function pridatOtazku(
  request: APIRequestContext,
  topicId: string,
  payload: { prompt: string; difficulty: 1 | 2 | 3; type?: 'short_answer' | 'true_false' },
): Promise<string> {
  const question =
    payload.type === 'true_false'
      ? {
          type: 'true_false' as const,
          difficulty: payload.difficulty,
          points: 1,
          blocks: [],
          payload: {
            prompt: payload.prompt,
            statements: [{ text: 'Tvrzení k otázce.', isTrue: true }],
          },
        }
      : {
          type: 'short_answer' as const,
          difficulty: payload.difficulty,
          points: 1,
          blocks: [],
          payload: { prompt: payload.prompt, answer: 'odpověď', acceptedAnswers: [] },
        }
  const created = await request.post('/api/questions', { data: { topicId, question } })
  expect(created.ok(), 'zkušební otázku se nepodařilo založit').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

/** Test s jedinou položkou — otázkou z tématu. Vzor: `createTest` v `e2e/testy.spec.ts`. */
async function vytvoritTest(
  request: APIRequestContext,
  title: string,
  questionId: string,
): Promise<string> {
  const created = await request.post('/api/tests', {
    data: {
      title,
      description: null,
      graded: true,
      templateId: 'builtin-klasicka',
      header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
      variants: 1,
      showKey: true,
      items: [{ kind: 'question', questionId }],
    },
  })
  expect(created.ok(), 'zkušební test se nepodařilo založit').toBe(true)
  const { id } = (await created.json()) as { id: string }
  return id
}

/** Přečte číslo v hlavičce „Otázky (N)“. */
async function headerCount(page: Page): Promise<number> {
  const text = await page.locator('h2', { hasText: 'Otázky (' }).textContent()
  const match = text?.match(/\((\d+)\)/)
  expect(match, `hlavička otázek nemá tvar „Otázky (N)“: ${text}`).toBeTruthy()
  return Number(match![1])
}

test.describe('otázky v tématu', () => {
  test('seznam ukazuje otázky jako karty, nejnovější první', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Nejnovější otázka ${Date.now()}`
    await pridatOtazku(page.request, topicId, { prompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const rows = page.locator('li[data-question-id]')
    await expect(rows.first()).toContainText(prompt)
  })

  test('úprava zůstane otevřená, i když jinde mezitím proběhne obnovení seznamu', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const puvodni = `Otázka k úpravě ${Date.now()}`
    const nove = `${puvodni} (upraveno)`
    await pridatOtazku(page.request, topicId, { prompt: puvodni, difficulty: 2 })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: puvodni })
    await row.getByRole('button', { name: 'Upravit' }).click()

    const promptField = row.getByLabel('Zadání')
    await expect(promptField).toHaveValue(puvodni)
    await promptField.fill(nove)

    // Jiná akce mezitím obnoví seznam (nová otázka přes formulář nahoře) —
    // rozpracovaná úprava se tím nesmí zavřít ani ztratit rozepsaný text.
    await page.getByRole('button', { name: 'Nová otázka' }).click()
    const newForm = page.getByTestId('new-question-form')
    // Typ nejdřív — přepnutí typu zadání zase vyprázdní (jiný typ má jiný
    // tvar odpovědi), takže by smazalo, co se do něj napsalo dřív.
    await newForm.getByLabel('Typ').click()
    await page.getByRole('option', { name: 'Krátká odpověď' }).click()
    await newForm.getByLabel('Zadání').fill(`Vedlejší otázka ${Date.now()}`)
    await newForm.getByLabel('Správná odpověď').fill('vedlejší')
    await newForm.getByRole('button', { name: 'Uložit' }).click()
    await expect(page.getByRole('button', { name: 'Nová otázka' })).toBeEnabled()

    // Formulář rozpracované úpravy pořád stojí a text zůstal, jak ho učitelka napsala.
    await expect(promptField).toHaveValue(nove)

    await row.getByRole('button', { name: 'Uložit' }).click()
    await expect(row.getByRole('button', { name: 'Upravit' })).toBeVisible()
    await expect(row).toContainText(nove)
  })

  test('smazání karty jde hned vrátit zpět', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka ke smazání ${Date.now()}`
    await pridatOtazku(page.request, topicId, { prompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Smazat' }).click()

    await expect(row).toHaveCount(0)
    const toast = page.getByText('Otázka smazána')
    await expect(toast).toBeVisible()
    await page.getByRole('button', { name: 'Vrátit zpět' }).click()

    await expect(page.locator('li[data-question-id]', { hasText: prompt })).toBeVisible()
  })

  test('filtr typu schová karty jiného typu', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const kratka = `Krátká odpověď filtr ${Date.now()}`
    const pravdaNepravda = `Pravda nepravda filtr ${Date.now()}`
    await pridatOtazku(page.request, topicId, { prompt: kratka, difficulty: 1 })
    await pridatOtazku(page.request, topicId, { prompt: pravdaNepravda, difficulty: 1, type: 'true_false' })

    await page.goto(`/topics/${topicId}`)
    await expect(page.locator('li[data-question-id]', { hasText: kratka })).toBeVisible()
    await expect(page.locator('li[data-question-id]', { hasText: pravdaNepravda })).toBeVisible()

    await page.locator('#topic-question-type-filter').click()
    await page.getByRole('option', { name: 'Pravda / nepravda' }).click()

    await expect(page.locator('li[data-question-id]', { hasText: pravdaNepravda })).toBeVisible()
    await expect(page.locator('li[data-question-id]', { hasText: kratka })).toHaveCount(0)
  })

  test('filtr typu nabízí jen typy, které téma opravdu má', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    await page.goto(`/topics/${topicId}`)

    await page.locator('#topic-question-type-filter').click()
    // Tohle téma má v sobě jen krátké odpovědi a pravda/nepravda (z ostatních
    // testů v tomhle souboru) — jiný typ (třeba doplňovačka) se model nikdy
    // nezeptal na vytvoření, takže by v nabídce jen strašil jako prázdná volba.
    await expect(page.getByRole('option', { name: 'Krátká odpověď' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Pravda / nepravda' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Doplňovačka' })).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('filtr bez shody nabídne zrušení filtru, ne hlášku o prázdném tématu', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka pro filtr bez shody ${Date.now()}`
    await pridatOtazku(page.request, topicId, { prompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    await expect(page.locator('li[data-question-id]', { hasText: prompt })).toBeVisible()

    // Obtížnost „Těžká“ v tomhle tématu nemá žádná otázka z tohohle souboru.
    await page.locator('#topic-question-difficulty-filter').click()
    await page.getByRole('option', { name: 'Těžká' }).click()

    await expect(page.getByText('Filtru neodpovídá žádná otázka.')).toBeVisible()
    // Hláška o prázdném tématu by tu byla zavádějící — otázky v něm jsou,
    // jen je zrovna schoval filtr.
    await expect(page.getByText('V tématu zatím nejsou otázky.')).toHaveCount(0)

    await page.getByRole('button', { name: 'Zrušit filtr' }).click()
    await expect(page.locator('li[data-question-id]', { hasText: prompt })).toBeVisible()
  })

  test('smazání karty sníží počet v hlavičce, přegenerování ho nechá stejný', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na počet v hlavičce ${Date.now()}`
    await pridatOtazku(page.request, topicId, { prompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()
    const before = await headerCount(page)

    await row.getByRole('button', { name: 'Smazat' }).click()
    await expect(row).toHaveCount(0)
    await expect.poll(() => headerCount(page)).toBe(before - 1)

    await page.getByRole('button', { name: 'Vrátit zpět' }).click()
    await expect(page.locator('li[data-question-id]', { hasText: prompt })).toBeVisible()
    await expect.poll(() => headerCount(page)).toBe(before)
  })

  test('přegenerování skryje starou kartu ihned, bez čekání na obnovení stránky', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka na přegenerování ${Date.now()}`
    await pridatOtazku(page.request, topicId, { prompt, difficulty: 1 })

    // Model se nevolá — jen se ověřuje, že karta zmizí hned po úspěšné
    // odpovědi, ne až po obnovení seznamu ze serveru (tam by zůstala viset,
    // protože server o výměně nic neví).
    await page.route('**/api/questions/regenerate', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { configured: true } })
        return
      }
      await route.fulfill({
        json: {
          question: {
            id: `nahrazena-${Date.now()}`,
            topicId,
            materialId: null,
            source: 'ai',
            status: 'approved',
            createdAt: new Date().toISOString(),
            type: 'short_answer',
            payload: { prompt: `${prompt} (nová)`, answer: 'odpověď', acceptedAnswers: [] },
            blocks: [],
            points: 1,
            difficulty: 1,
          },
        },
      })
    })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: 'Přegenerovat' }).click()

    await expect(row).toHaveCount(0)
  })

  test('karta ukáže, ve kterém testu otázka je, a filtr ji podle toho schová', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const prompt = `Otázka pro použití v testu ${Date.now()}`
    const questionId = await pridatOtazku(page.request, topicId, { prompt, difficulty: 1 })
    const nazevTestu = `E2E test s otázkou tématu ${Date.now()}`
    const testId = await vytvoritTest(page.request, nazevTestu, questionId)

    // Kontrolní otázka beze zařazení do testu — filtr ji nesmí schovat.
    const nepouzitaPrompt = `Otázka bez testu ${Date.now()}`
    await pridatOtazku(page.request, topicId, { prompt: nepouzitaPrompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    const nepouzitaRow = page.locator('li[data-question-id]', { hasText: nepouzitaPrompt })
    await expect(row).toBeVisible()
    await expect(nepouzitaRow).toBeVisible()
    const odkaz = row.getByRole('link', { name: nazevTestu })
    await expect(odkaz).toBeVisible()
    await expect(odkaz).toHaveAttribute('href', `/tests/${testId}`)

    await page.getByRole('checkbox', { name: 'Jen nepoužité v testu' }).click()
    await expect(row).toHaveCount(0)
    await expect(nepouzitaRow).toBeVisible()

    await page.getByRole('checkbox', { name: 'Jen nepoužité v testu' }).click()
    await expect(row).toBeVisible()
  })

  test('vrácení smazané karty funguje i po mezitímním obnovení seznamu jinou akcí', async ({ page }) => {
    const topicId = await ensureTopic(page.request)
    const a = `Karta A ke smazání ${Date.now()}`
    const b = `Karta B k úpravě ${Date.now()}`
    await pridatOtazku(page.request, topicId, { prompt: a, difficulty: 1 })
    await pridatOtazku(page.request, topicId, { prompt: b, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const rowA = page.locator('li[data-question-id]', { hasText: a })
    const rowB = page.locator('li[data-question-id]', { hasText: b })
    await expect(rowA).toBeVisible()
    await expect(rowB).toBeVisible()

    await rowA.getByRole('button', { name: 'Smazat' }).click()
    await expect(rowA).toHaveCount(0)
    const toast = page.getByText('Otázka smazána')
    await expect(toast).toBeVisible()

    // Mezitím proběhne úprava jiné karty — ta po uložení volá
    // `router.refresh()`, takže seznam se obnoví dřív, než se klikne na
    // „Vrátit zpět“.
    await rowB.getByRole('button', { name: 'Upravit' }).click()
    const editovana = `${b} (upraveno)`
    await rowB.getByLabel('Zadání').fill(editovana)
    await rowB.getByRole('button', { name: 'Uložit' }).click()
    await expect(page.getByText(editovana)).toBeVisible()

    await page.getByRole('button', { name: 'Vrátit zpět' }).click()
    await expect(page.locator('li[data-question-id]', { hasText: a })).toBeVisible()
  })
})

test.describe('téma bez otázek', () => {
  test('smazání jediné otázky ukáže prázdný stav tématu', async ({ page }) => {
    // Vlastní název bez společných slov s `TOPIC` — jinak by ho slučování
    // podobných názvů (`sameTopic` v `packages/core/src/extract/grouping.ts`)
    // spojilo se sdíleným tématem tohohle souboru místo založení nového.
    // Přípona čistě z číslic by se přitom nepočítala vůbec — `topicTokens`
    // číselné tokeny zahazuje — takže dva běhy tohohle testu by kvůli tomu
    // sami sebe slily dohromady; `toString(36)` dá do přípony i písmena.
    const topicId = await ensureTopic(page.request, `E2E izolovane prazdne tema ${Date.now().toString(36)}`)
    const prompt = `Jediná otázka tématu ${Date.now()}`
    await pridatOtazku(page.request, topicId, { prompt, difficulty: 1 })

    await page.goto(`/topics/${topicId}`)
    const row = page.locator('li[data-question-id]', { hasText: prompt })
    await expect(row).toBeVisible()

    await row.getByRole('button', { name: 'Smazat' }).click()
    await expect(row).toHaveCount(0)
    await expect(page.getByText('V tématu zatím nejsou otázky.')).toBeVisible()
  })
})
