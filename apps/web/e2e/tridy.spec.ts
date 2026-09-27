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
      await page.locator(`a[href="/tridy/${gradeId}"]`).click()
      await expect(page).toHaveURL(`/tridy/${gradeId}`)
      await expect(page.getByRole('heading', { name: GRADE, exact: true })).toBeVisible()
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
