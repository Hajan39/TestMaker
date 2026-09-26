import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Otázky v tématu jako karty: úprava přímo v seznamu, přegenerování, smazání
 * s možností vrácení, filtr a čtení bez práv u role `nahled`.
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

/** Založí (nebo najde) zkušební téma jen pro tenhle soubor. Vrací jeho id. */
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
          contentHash: 'e2e-tema-otazky-v1',
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

/** Založí unikátní otázku a vrátí její zadání. */
async function pridatOtazku(
  request: APIRequestContext,
  topicId: string,
  payload: { prompt: string; difficulty: 1 | 2 | 3; type?: 'short_answer' | 'true_false' },
): Promise<void> {
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
    await newForm.locator('#question-editor-type').click()
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
})

/**
 * Role `nahled`: čte a tiskne, ale karty nejde upravit ani smazat a nový
 * formulář se nenabízí. Běží jen přes přihlašovací konfiguraci (port 3101) —
 * stejně jako `role.spec.ts`, jehož vzor tu následuje.
 */
test.describe('otázky v tématu — role nahled', () => {
  test.use({ storageState: 'e2e/.auth/nahled.json' })

  test.beforeEach(({ baseURL }) => {
    test.skip(
      !baseURL?.includes('3101'),
      'Spouštěj přes: pnpm exec playwright test -c playwright.login.config.ts',
    )
  })

  test('náhled vidí seznam otázek, ale žádné tlačítko, které by je měnilo', async ({ page, browser, baseURL }) => {
    // Náhled sám nesmí zapisovat — téma i otázku pro něj založí učitelka
    // ve vlastním kontextu, nahled si pak jen otevře stránku ke čtení.
    const pisatel = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json', baseURL })
    let topicId: string
    try {
      topicId = await ensureTopic(pisatel.request)
      await pridatOtazku(pisatel.request, topicId, { prompt: `Otázka pro náhled ${Date.now()}`, difficulty: 1 })
    } finally {
      await pisatel.close()
    }

    await page.goto(`/topics/${topicId}`)

    // `exact: true` je tu podstatné: „Upravit téma“ i „Smazat téma“ jinak
    // vyhoví i hledání „Upravit“/„Smazat“ podřetězcem a test by mlčky
    // procházel, i kdyby karta svoje tlačítko skutečně nabízela.
    await expect(page.locator('li[data-question-id]').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Nová otázka', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Upravit', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Smazat', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Nahradit modelem', exact: true })).toHaveCount(0)
  })
})
