import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Úvod jako rozcestník na třídy: dlaždice vedou na `/tridy/[gradeId]`,
 * naposledy otevřená třída se pamatuje v prohlížeči a „Všechny třídy"
 * (`/?vse=1`) přesměrování na ni potlačí. Na stránce třídy jde přidat i
 * přesunout téma.
 *
 * Prázdná knihovna (bod revize 5) se tu neověřuje e2e — všechny zkušební účty
 * sdílejí jednu naseedovanou školu, takže žádný z nich prázdnou knihovnu
 * nemá a založit si vlastní prázdnou školu jen pro tenhle test by bylo za cenu
 * nové infrastruktury jen pro jeden případ. Místo toho je v
 * `apps/web/test/library-api.test.ts` jednotkový test, který ověřuje přesně tu
 * podmínku, na které úvod přepíná na `EmptyState` — `loadLibraryTree` vrací
 * pro školu bez dat prázdné pole.
 */

const RAZITKO = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** Založí předmět s jedním ročníkem přes API a vrátí obojí id. */
async function zalozTridu(
  request: APIRequestContext,
  subjectName: string,
  gradeName: string,
): Promise<{ subjectId: string; gradeId: string }> {
  const subject = await request.post('/api/library', {
    data: { kind: 'subject', name: subjectName },
  })
  expect(subject.ok(), 'zkušební předmět se nepodařilo založit').toBe(true)
  const { id: subjectId } = (await subject.json()) as { id: string }

  const grade = await request.post('/api/library', {
    data: { kind: 'grade', name: gradeName, parentId: subjectId },
  })
  expect(grade.ok(), 'zkušební ročník se nepodařilo založit').toBe(true)
  const { id: gradeId } = (await grade.json()) as { id: string }

  return { subjectId, gradeId }
}

async function smazPredmet(request: APIRequestContext, subjectId: string): Promise<void> {
  const smazano = await request.delete(`/api/library?kind=subject&id=${encodeURIComponent(subjectId)}`)
  expect(smazano.ok(), 'zkušební předmět se nepodařilo uklidit').toBe(true)
}

/** Vyplní otevřený dialog a potvrdí ho. */
async function vyplnDialog(page: Page, pole: string, hodnota: string, tlacitko: string) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(pole).fill(hodnota)
  await dialog.getByRole('button', { name: tlacitko, exact: true }).click()
  await expect(dialog).toBeHidden()
}

test.describe('rozcestník tříd', () => {
  test('dlaždice třídy vede na stránku třídy', async ({ page }) => {
    // Vlastní razítko i v názvu ročníku — seed má reálné „6./7./8. ročník" a
    // hledání podle pouhého čísla by se do nich mohlo trefit.
    const GRADE = `5. ročník ${RAZITKO}`
    const { subjectId, gradeId } = await zalozTridu(page.request, `E2E TRIDY DLAZDICE ${RAZITKO}`, GRADE)
    try {
      await page.goto('/?vse=1')
      // Stejný odkaz teď vede i z postranního panelu, ne jen z dlaždice —
      // proto se hledá jen v obsahové ploše, jinak by na něj mířily dva prvky.
      const obsah = page.getByRole('region', { name: 'Třídy' })
      await obsah.locator(`a[href="/tridy/${gradeId}"]`).click()
      await expect(page).toHaveURL(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()
    } finally {
      await smazPredmet(page.request, subjectId)
    }
  })

  test('odkaz na třídu v postranním panelu otevře stránku třídy s jejími tématy uprostřed', async ({
    page,
  }) => {
    // Tři sloupce patří i úvodu a stránce třídy, ne jen tématu — postranní
    // panel s ročníky je proto na obou vidět a vede na tutéž stránku třídy,
    // jejíž prostřední sloupec ukáže rovnou její témata.
    const GRADE = `4. ročník ${RAZITKO}`
    const TEMA = `Téma v postranním panelu ${RAZITKO}`
    const { subjectId, gradeId } = await zalozTridu(page.request, `E2E TRIDY PANEL ${RAZITKO}`, GRADE)
    const topic = await page.request.post('/api/library', {
      data: { kind: 'topic', name: TEMA, parentId: gradeId },
    })
    expect(topic.ok(), 'zkušební téma se nepodařilo založit').toBe(true)

    try {
      await page.goto('/?vse=1')
      const sidebar = page.getByRole('complementary', { name: 'Předměty a ročníky' })
      await sidebar.getByRole('link', { name: GRADE, exact: false }).click()

      await expect(page).toHaveURL(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()

      const stredniSloupec = page.getByRole('complementary', { name: 'Témata ročníku' })
      await expect(stredniSloupec.getByText(TEMA, { exact: true })).toBeVisible()
    } finally {
      await smazPredmet(page.request, subjectId)
    }
  })

  test('po návštěvě třídy nová návštěva úvodu skončí na ní', async ({ page }) => {
    const GRADE = `6. ročník ${RAZITKO}`
    const { subjectId, gradeId } = await zalozTridu(page.request, `E2E TRIDY PAMET ${RAZITKO}`, GRADE)
    try {
      await page.goto(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()
      // Nadpis je vidět už z vykreslení na serveru; třídu si zapamatuje až
      // efekt po hydrataci. Bez čekání by test odešel dřív (ve WebKitu ano).
      await expect.poll(() => page.evaluate(() => Object.values(localStorage))).toContain(gradeId)

      // Nová návštěva úvodu bez `?vse=1` přesměruje rovnou do zapamatované třídy.
      await page.goto('/')
      await page.waitForURL(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()
    } finally {
      await smazPredmet(page.request, subjectId)
    }
  })

  test('položka „Třídy" v liště ukáže dlaždice i se zapamatovanou třídou', async ({ page }) => {
    const GRADE = `9. ročník ${RAZITKO}`
    const { subjectId, gradeId } = await zalozTridu(page.request, `E2E TRIDY LISTA ${RAZITKO}`, GRADE)
    try {
      await page.goto(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()

      // Klik na „Třídy“ v liště nesmí skončit zpátky v zapamatované třídě —
      // vede vždy na přehled dlaždic (`/?vse=1`), stejně jako odkaz „Všechny třídy“.
      await page.getByRole('link', { name: 'Třídy', exact: true }).click()
      await expect(page).toHaveURL('/?vse=1')
      await expect(page.getByText(GRADE, { exact: false }).first()).toBeVisible()
    } finally {
      await smazPredmet(page.request, subjectId)
    }
  })

  test('„Všechny třídy" ukáže dlaždice i se zapamatovanou třídou', async ({ page }) => {
    const GRADE = `7. ročník ${RAZITKO}`
    const { subjectId, gradeId } = await zalozTridu(page.request, `E2E TRIDY VSECHNY ${RAZITKO}`, GRADE)
    try {
      await page.goto(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()

      await page.goto('/?vse=1')
      // Přesměrování je potlačené — zůstávají dlaždice, ne stránka třídy.
      await expect(page).toHaveURL('/?vse=1')
      await expect(page.getByText(GRADE, { exact: false }).first()).toBeVisible()
    } finally {
      await smazPredmet(page.request, subjectId)
    }
  })

  test('smazaná zapamatovaná třída — úvod ji tiše zapomene a ukáže dlaždice', async ({ page }) => {
    const GRADE = `8. ročník ${RAZITKO}`
    const { subjectId, gradeId } = await zalozTridu(page.request, `E2E TRIDY SMAZANA ${RAZITKO}`, GRADE)
    // Ročník navštívíme, aby se zapamatoval, a pak ho i s předmětem smažeme —
    // zapamatovaný odkaz teď míří na něco, co v knihovně už není.
    await page.goto(`/tridy/${gradeId}`)
    await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()
    await smazPredmet(page.request, subjectId)

    await page.goto('/')
    // Žádné přesměrování na 404: úvod si zapomenutou třídu odpustí a ukáže dlaždice.
    await expect(page).toHaveURL('/')
    await expect(page.getByText(GRADE, { exact: false })).toHaveCount(0)
    await expect(page.locator('a[href^="/tridy/"]').first()).toBeVisible()
  })

  test('cizí nebo neexistující třída vede na českou hlášku „Třída už neexistuje"', async ({ page }) => {
    // Ve vývojovém serveru Next.js vrací stránku `notFound()` se stavem 200
    // (dorovná se to až v produkčním sestavení) — ověřuje se proto obsah.
    await page.goto('/tridy/neexistujici-trida-xyz')
    await expect(page.getByText('Třída už neexistuje')).toBeVisible()
    const zpet = page.getByRole('link', { name: 'Všechny třídy' })
    await expect(zpet).toBeVisible()
    await zpet.click()
    await expect(page).toHaveURL('/?vse=1')
  })
})

test.describe('správa tématu na stránce třídy', () => {
  test('přidá téma a přesune ho do jiného ročníku téhož předmětu', async ({ page }) => {
    const subjectName = `E2E TRIDY SPRAVA ${RAZITKO}`
    const GRADE_1 = `1. ročník ${RAZITKO}`
    const GRADE_2 = `2. ročník ${RAZITKO}`
    const { subjectId, gradeId: gradeId1 } = await zalozTridu(page.request, subjectName, GRADE_1)
    const grade2 = await page.request.post('/api/library', {
      data: { kind: 'grade', name: GRADE_2, parentId: subjectId },
    })
    expect(grade2.ok()).toBe(true)
    const { id: gradeId2 } = (await grade2.json()) as { id: string }

    const TEMA = `Přesouvané téma ${RAZITKO}`

    try {
      // --- Přidání tématu na stránce třídy ---------------------------------
      await page.goto(`/tridy/${gradeId1}`)
      await page.getByRole('button', { name: 'Přidat téma' }).click()
      await vyplnDialog(page, 'Název tématu', TEMA, 'Založit')

      // Po založení tématu se otevře jeho vlastní stránka.
      await expect(page).toHaveURL(/\/topics\//)
      await expect(page.getByRole('heading', { name: TEMA, exact: true })).toBeVisible()

      // --- Přesun do jiného ročníku ----------------------------------------
      await page.goto(`/tridy/${gradeId1}`)
      await expect(page.getByText(TEMA, { exact: true }).first()).toBeVisible()

      const presun = page.getByLabel('Přesunout téma do jiného ročníku')
      await presun.click()
      await page.getByRole('option', { name: GRADE_2, exact: true }).click()

      await expect(page.getByText(`Téma přesunuto do ${GRADE_2}`)).toBeVisible()

      // Téma zmizí ze staré třídy...
      await expect(page.getByText(TEMA, { exact: true })).toHaveCount(0)

      // ...a objeví se v nové.
      await page.goto(`/tridy/${gradeId2}`)
      await expect(page.getByText(TEMA, { exact: true }).first()).toBeVisible()
    } finally {
      await smazPredmet(page.request, subjectId)
    }
  })
})

test.describe('staré adresy', () => {
  test('/?grade=<id> s neplatnými znaky v id se nerozbije na přesměrování', async ({ page }) => {
    // `encodeURIComponent` v cíli přesměrování — bez něj by id se
    // svislítkem nebo otazníkem propadlo do dotazu jiné cesty.
    await page.goto(`/?grade=${encodeURIComponent('divne/id?a=b')}`)
    await expect(page).toHaveURL(/\/tridy\/divne%2Fid%3Fa%3Db$/)
  })

  test('/questions a /review s topicId vedou na dané téma, bez něj na úvod', async ({ page }) => {
    const subjectName = `E2E STARE ADRESY ${RAZITKO}`
    const { subjectId, gradeId } = await zalozTridu(page.request, subjectName, `Ročník ${RAZITKO}`)
    try {
      const topic = await page.request.post('/api/library', {
        data: { kind: 'topic', name: 'Téma pro starou adresu', parentId: gradeId },
      })
      expect(topic.ok(), 'zkušební téma se nepodařilo založit').toBe(true)
      const { id: topicId } = (await topic.json()) as { id: string }

      await page.goto(`/questions?topicId=${topicId}`)
      await expect(page).toHaveURL(`/topics/${topicId}`)

      await page.goto(`/review?topicId=${topicId}`)
      await expect(page).toHaveURL(`/topics/${topicId}`)

      await page.goto('/questions')
      await expect(page).toHaveURL('/')

      await page.goto('/review')
      await expect(page).toHaveURL('/')
    } finally {
      await smazPredmet(page.request, subjectId)
    }
  })
})

test.describe('pořadí témat v ročníku', () => {
  test('témata jsou česky podle abecedy, jdou přeskládat a vrátit k abecedě', async ({ page }) => {
    const { subjectId, gradeId } = await zalozTridu(page.request, `E2E PORADI ${RAZITKO}`, 'Pořadí')
    try {
      // Schválně v pořadí, které SQL řadí špatně: `10.` před `2.`.
      for (const name of ['10. Savci', '2. Ptáci', '1. Úvod']) {
        const topic = await page.request.post('/api/library', {
          data: { kind: 'topic', name, parentId: gradeId },
        })
        expect(topic.ok(), `téma „${name}" se nepodařilo založit`).toBe(true)
      }

      await page.goto(`/tridy/${gradeId}`)
      const seznam = page.getByTestId('temata-rocniku')
      const poradi = () => seznam.getByRole('button', { name: /^Přesunout téma / }).evaluateAll(
        (uchyty) => uchyty.map((uchyt) => uchyt.getAttribute('aria-label')?.replace('Přesunout téma ', '')),
      )
      await expect.poll(poradi).toEqual(['1. Úvod', '2. Ptáci', '10. Savci'])

      // Přeskládání z klávesnice: mezerník zvedne, šipka posune, mezerník položí.
      const uchyt = seznam.getByRole('button', { name: 'Přesunout téma 10. Savci' })
      // dnd-kit mezi kroky počítá polohu dlaždic, proto krátké pauzy.
      await uchyt.focus()
      for (const klavesa of ['Space', 'ArrowLeft', 'ArrowLeft', 'Space']) {
        await page.keyboard.press(klavesa)
        await page.waitForTimeout(150)
      }
      await expect.poll(poradi).toEqual(['10. Savci', '1. Úvod', '2. Ptáci'])

      // Pořadí se uložilo: po obnovení stránky platí dál.
      await page.reload()
      await expect.poll(poradi).toEqual(['10. Savci', '1. Úvod', '2. Ptáci'])

      await page.getByRole('button', { name: 'Seřadit podle abecedy' }).click()
      await expect.poll(poradi).toEqual(['1. Úvod', '2. Ptáci', '10. Savci'])
      await expect(page.getByRole('button', { name: 'Seřadit podle abecedy' })).toHaveCount(0)
    } finally {
      await smazPredmet(page.request, subjectId)
    }
  })
})
