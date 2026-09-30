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
  await expect(page.getByRole('link', { name: 'Třídy' })).toBeVisible()

  // Import, generování a banka otázek zmizely z lišty úplně (nejen náhledu) —
  // import a generování zůstávají jako stránky, banka se zrušila docela.
  await expect(page.getByRole('link', { name: 'Import materiálů' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Generování', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Banka otázek' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Správa' })).toHaveCount(0)

  await expect(page.getByRole('button', { name: 'Založit předmět' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Smazat předmět/ })).toHaveCount(0)
  // Import a nový test jsou taky akce ke změně — na úvodu se náhledu
  // nenabízejí, byť stránky `/import` a `/tests/new` samy zůstávají.
  await expect(page.getByRole('button', { name: 'Hromadný import' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nový test' })).toHaveCount(0)
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
  // Šipka vedle „Přegenerovat" nese i „Lehčí verze"/„Těžší verze" — celé menu
  // je pryč, tvorbu verzí tedy nahled nemá odkud spustit.
  await expect(page.getByRole('button', { name: 'Přegenerovat s důvodem' })).toHaveCount(0)

  // Zaškrtávátko „Vybrat do testu“ a lišta výběru jsou taky akce ke změně —
  // náhled do banky nic nepřidává, ani do ní vybírat otázky nemá jak.
  await expect(page.getByRole('checkbox', { name: 'Vybrat do testu' })).toHaveCount(0)
  await expect(page.getByText(/^Vybráno/)).toHaveCount(0)

  // Přepínač „Smazané“ vede k obnovení otázky — taky akce ke změně, kterou
  // náhled nemá.
  await expect(page.getByRole('button', { name: /^Smazané \(\d+\)$/ })).toHaveCount(0)
})

/**
 * Stránka třídy (viz `tridy.spec.ts`): náhled vidí témata, ale žádné
 * tlačítko, které by třídu nebo její témata měnilo.
 *
 * Vlastní zkušební třída pro tenhle test — založí ji učitelka ve vlastním
 * kontextu, náhled si stránku jen přečte.
 */
test('náhled vidí témata třídy, ale žádné tlačítko, které by ji měnilo', async ({
  page,
  browser,
  baseURL,
}) => {
  const pisatel = await browser.newContext({ storageState: 'e2e/.auth/ucitelkaA.json', baseURL })
  let gradeId: string
  let gradeName: string
  try {
    const subject = await pisatel.request.post('/api/library', {
      data: { kind: 'subject', name: `E2E NAHLED TRIDA ${Date.now()}` },
    })
    expect(subject.ok(), 'zkušební předmět se nepodařilo založit').toBe(true)
    const { id: subjectId } = (await subject.json()) as { id: string }

    gradeName = `Náhledový ročník ${Date.now()}`
    const grade = await pisatel.request.post('/api/library', {
      data: { kind: 'grade', name: gradeName, parentId: subjectId },
    })
    expect(grade.ok(), 'zkušební ročník se nepodařilo založit').toBe(true)
    gradeId = (await grade.json()).id as string

    const topic = await pisatel.request.post('/api/library', {
      data: { kind: 'topic', name: 'Téma pro náhled', parentId: gradeId },
    })
    expect(topic.ok(), 'zkušební téma se nepodařilo založit').toBe(true)
  } finally {
    await pisatel.close()
  }

  await page.goto(`/tridy/${gradeId}`)
  await expect(page.getByRole('heading', { name: gradeName, exact: true })).toBeVisible()
  // Téma je teď vidět dvakrát — v prostředním sloupci i na dlaždici v obsahu —
  // hledá se proto jen v obsahové ploše.
  const obsah = page.getByRole('region', { name: 'Obsah třídy' })
  await expect(obsah.getByText('Téma pro náhled', { exact: true })).toBeVisible()

  await expect(page.getByRole('button', { name: 'Přidat téma' })).toHaveCount(0)
  await expect(page.getByLabel('Přesunout téma do jiného ročníku')).toHaveCount(0)
  // „Vygenerovat pro celou třídu" je popisek tlačítka až uvnitř panelu
  // hromadného generování — celý panel i jeho spouštěč zmizí zároveň.
  await expect(page.getByRole('button', { name: 'Hromadné generování' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Přejmenovat/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Smazat ročník' })).toHaveCount(0)
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

/**
 * Mazání v knihovně (`DELETE /api/library`): téma smaže i ucitelka — s tématem
 * pracuje celá, od založení po smazání. Předmět a ročník, pod kterými leží
 * práce celé školy, jen správce; tlačítka „Smazat ročník"/„Smazat předmět" se
 * jí proto vůbec nenabízejí, jinak by narazila na 403 (viz `DeleteFromLibrary`).
 */
test.describe('ucitelka maže témata, předměty a ročníky ne', () => {
  test.use({ storageState: 'e2e/.auth/ucitelkaA.json' })

  test('ucitelka založí téma, přejmenuje ho a smaže', async ({ page, request }) => {
    const subject = await request.post('/api/library', {
      data: { kind: 'subject', name: `E2E UCITELKA TEMA ${Date.now()}` },
    })
    expect(subject.ok(), 'zkušební předmět se nepodařilo založit').toBe(true)
    const { id: subjectId } = (await subject.json()) as { id: string }
    const grade = await request.post('/api/library', {
      data: { kind: 'grade', name: `Ročník pro téma ${Date.now()}`, parentId: subjectId },
    })
    expect(grade.ok(), 'zkušební ročník se nepodařilo založit').toBe(true)
    const { id: gradeId } = (await grade.json()) as { id: string }

    const topic = await request.post('/api/library', {
      data: { kind: 'topic', name: 'Učitelčino téma', parentId: gradeId },
    })
    expect(topic.ok(), 'ucitelka nezaložila téma').toBe(true)
    const { id: topicId } = (await topic.json()) as { id: string }

    const renamed = await request.patch('/api/library', {
      data: { kind: 'topic', id: topicId, name: 'Učitelčino téma přejmenované' },
    })
    expect(renamed.ok(), 'ucitelka nepřejmenovala téma').toBe(true)

    await page.goto(`/topics/${topicId}`)
    await expect(page.getByRole('heading', { name: 'Učitelčino téma přejmenované' })).toBeVisible()
    await page.getByRole('button', { name: 'Smazat téma' }).first().click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Smazat' }).click()
    await expect(page).not.toHaveURL(new RegExp(topicId))

    const gone = await request.get(`/api/library?kind=topic&id=${encodeURIComponent(topicId)}`)
    expect(gone.status()).toBe(404)

    // Ročník ani předmět smazat nesmí — ani přímo přes API.
    const gradeDelete = await request.delete(`/api/library?kind=grade&id=${encodeURIComponent(gradeId)}`)
    expect(gradeDelete.status()).toBe(403)
    const subjectDelete = await request.delete(`/api/library?kind=subject&id=${encodeURIComponent(subjectId)}`)
    expect(subjectDelete.status()).toBe(403)
  })

  test('stránka třídy ucitelce nenabídne „Smazat ročník"', async ({ page, request }) => {
    const subject = await request.post('/api/library', {
      data: { kind: 'subject', name: `E2E UCITELKA MAZANI ${Date.now()}` },
    })
    expect(subject.ok(), 'zkušební předmět se nepodařilo založit').toBe(true)
    const { id: subjectId } = (await subject.json()) as { id: string }

    const gradeName = `Ucitelčin ročník ${Date.now()}`
    const grade = await request.post('/api/library', {
      data: { kind: 'grade', name: gradeName, parentId: subjectId },
    })
    expect(grade.ok(), 'zkušební ročník se nepodařilo založit').toBe(true)
    const { id: gradeId } = (await grade.json()) as { id: string }

    await page.goto(`/tridy/${gradeId}`)
    await expect(page.getByRole('heading', { name: gradeName, exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Smazat ročník' })).toHaveCount(0)
    // Ostatní akce ke změně (přejmenování, přidání tématu) jí zůstávají.
    await expect(page.getByRole('button', { name: 'Přidat téma' })).toBeVisible()
  })

  test('úvod ucitelce nenabídne „Smazat předmět"', async ({ page, request }) => {
    const subjectName = `E2E UCITELKA PREDMET ${Date.now()}`
    const subject = await request.post('/api/library', { data: { kind: 'subject', name: subjectName } })
    expect(subject.ok(), 'zkušební předmět se nepodařilo založit').toBe(true)

    await page.goto('/?vse=1')
    // Jméno předmětu je teď vidět i v postranním panelu — hledá se proto
    // jen v obsahové ploše, kde je nadpisem sekce.
    await expect(page.getByRole('heading', { name: subjectName })).toBeVisible()
    await expect(page.getByRole('button', { name: /Smazat předmět/ })).toHaveCount(0)
    // Přejmenovat a přidat ročník ucitelce zůstávají — jen mazání je pryč.
    await expect(page.getByRole('button', { name: /Založit předmět/ })).toBeVisible()
  })
})
