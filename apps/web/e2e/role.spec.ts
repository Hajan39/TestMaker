import { expect, test, type APIRequestContext } from '@playwright/test'

/**
 * Role `nahled`: čte a tiskne, ale nic nemění. Brána zapisující požadavky
 * zastaví tak jako tak — tady se ověřuje ta srozumitelnější polovina, tedy
 * že rozhraní nenabízí tlačítka, která by stejně skončila odmítnutím.
 */
test.use({ storageState: 'e2e/.auth/nahled.json' })

test.beforeEach(({ baseURL }) => {
  test.skip(
    !baseURL?.includes('3101'),
    'Spouštěj přes: pnpm exec playwright test -c playwright.login.config.ts',
  )
})

test('náhled si knihovnu prohlíží, ale nic v ní nezaloží ani nesmaže', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'Banka otázek' })).toBeVisible()

  // Import a generování jsou cesty k zápisu — náhledu se vůbec nenabízejí.
  await expect(page.getByRole('link', { name: 'Import materiálů' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Generování' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Správa' })).toHaveCount(0)

  await expect(page.getByRole('button', { name: 'Založit předmět' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Smazat předmět/ })).toHaveCount(0)
})

test('zápis odmítne i server, ne jen skryté tlačítko', async ({ page }) => {
  const odpoved = await page.request.post('/api/library', {
    data: { kind: 'subject', name: 'Náhled sem nesmí' },
  })
  expect(odpoved.status()).toBe(403)
})

test('do správy se náhled nedostane', async ({ page }) => {
  await page.goto('/sprava')
  // Brána ho vrátí na úvodní obrazovku.
  await expect(page).toHaveURL(/\/$/)
})

/**
 * Otázky v tématu jako karty (viz `tema-otazky.spec.ts`): karty vidí,
 * ale žádné tlačítko, které by je měnilo, se mu nenabízí.
 *
 * Vlastní zkušební téma pro tenhle soubor — založí ho učitelka ve vlastním
 * kontextu (náhled sám zapisovat nesmí), náhled si stránku jen přečte.
 */
const TEMA_SUBJECT = 'E2E KONTROLA'
const TEMA_GRADE = 'E2E otázky tématu'
const TEMA_TOPIC = 'Otázky v tématu jako karty'
const TEMA_TEXT =
  'Koloběh látek v přírodě propojuje živé organismy s neživým prostředím prostřednictvím výměny látek a energie. '.repeat(
    12,
  )

async function ensureTemaOtazky(request: APIRequestContext): Promise<string> {
  const imported = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: `${TEMA_SUBJECT}/${TEMA_GRADE}/${TEMA_TOPIC}.txt`,
          fileName: `${TEMA_TOPIC}.txt`,
          subject: TEMA_SUBJECT,
          grade: TEMA_GRADE,
          topic: TEMA_TOPIC,
          mimeType: 'text/plain',
          sizeBytes: TEMA_TEXT.length,
          text: TEMA_TEXT,
          pageCount: null,
          needsOcr: false,
          contentHash: 'e2e-tema-otazky-v1',
        },
      ],
    },
  })
  expect(imported.ok(), 'zkušební materiál se nepodařilo naimportovat').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(TEMA_TOPIC)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const topic = results.find((result) => result.topicName.includes(TEMA_TOPIC))
  expect(topic, `zkušební téma „${TEMA_TOPIC}“ se v knihovně nenašlo`).toBeTruthy()
  return topic!.topicId
}

test('náhled vidí karty otázek v tématu, ale žádné tlačítko, které by je měnilo', async ({
  page,
  browser,
  baseURL,
}) => {
  // Náhled sám nesmí zapisovat — téma i otázku pro něj založí učitelka
  // ve vlastním kontextu, náhled si pak jen otevře stránku ke čtení.
  const pisatel = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json', baseURL })
  let topicId: string
  try {
    topicId = await ensureTemaOtazky(pisatel.request)
    const created = await pisatel.request.post('/api/questions', {
      data: {
        topicId,
        question: {
          type: 'short_answer',
          difficulty: 1,
          points: 1,
          blocks: [],
          payload: { prompt: `Otázka pro náhled ${Date.now()}`, answer: 'odpověď', acceptedAnswers: [] },
        },
      },
    })
    expect(created.ok(), 'zkušební otázku se nepodařilo založit').toBe(true)
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
  await expect(page.getByRole('button', { name: 'Přegenerovat', exact: true })).toHaveCount(0)

  // Zaškrtávátko „Vybrat do testu“ a lišta výběru jsou taky akce ke změně —
  // náhled do banky nic nepřidává, ani do ní vybírat otázky nemá jak.
  await expect(page.getByRole('checkbox', { name: 'Vybrat do testu' })).toHaveCount(0)
  await expect(page.getByText(/^Vybráno/)).toHaveCount(0)

  // Přepínač „Smazané“ vede k obnovení otázky — taky akce ke změně, kterou
  // náhled nemá.
  await expect(page.getByRole('button', { name: /^Smazané \(\d+\)$/ })).toHaveCount(0)
})

/**
 * Pruh materiálů (viz `tema-materialy.spec.ts`): náhled ho vidí, ale bez
 * nahrávání, přepínače „Použít pro generování“, mazání a „Upravit téma“ —
 * to všechno jsou akce ke změně, které mu brána i tak odmítne.
 */
test('náhled vidí pruh materiálů, ale bez nahrávání, přepínače a mazání', async ({ page, browser, baseURL }) => {
  // Náhled sám nesmí zapisovat — téma pro něj založí učitelka ve vlastním
  // kontextu, náhled si pak jen otevře stránku ke čtení.
  const pisatel = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json', baseURL })
  let topicId: string
  try {
    topicId = await ensureTemaOtazky(pisatel.request)
  } finally {
    await pisatel.close()
  }

  await page.goto(`/topics/${topicId}`)
  await page.getByRole('button', { name: /^Materiály/ }).click()

  await expect(page.getByText(`${TEMA_TOPIC}.txt`)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nahrát materiály' })).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: /Použít pro generování/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Smazat', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Upravit téma', exact: true })).toHaveCount(0)
})
