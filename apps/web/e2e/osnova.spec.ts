import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * Položka na stránce písemky: co jde nastavit jen pro tenhle test, aniž by se
 * měnila otázka v bance. Ovládání položky (body, řádky, odebrání) se vynoří
 * u okraje listu, když je položka pod myší nebo v ní stojí ohnisko.
 */

const SUBJECT = 'E2E OSNOVA'
const GRADE = 'E2E osnova testu'

/**
 * Vlastní izolované téma se dvěma otázkami „krátká odpověď“ — bez vnořeného
 * seznamu možností. `[data-slot="paper-sheet"] ol > li` totiž chytá i vnitřní
 * `<ol>` odpovědí (možnosti u výběru, dvojice u přiřazování…), takže „první
 * dvě schválené otázky odkudkoli z banky“ dřív občas byly typu s možnostmi
 * a počty položek na stránce se rozjely. Tady se místo pořadí v DOM sahá po
 * vlastních datech přes vyhledávací filtr banky, ať výsledek nezávisí na tom,
 * co zrovna leží v bance z jiných souborů.
 */
async function seedOsnovaTopic(request: APIRequestContext): Promise<{ topicId: string; marker: string }> {
  const marker = `Osnova test ${Date.now().toString(36)}`
  const text = `${marker} popisuje vztahy mezi organismy v přírodě. `.repeat(12)
  const imported = await request.post('/api/materials', {
    data: {
      materials: [
        {
          relativePath: `${SUBJECT}/${GRADE}/${marker}.txt`,
          fileName: `${marker}.txt`,
          subject: SUBJECT,
          grade: GRADE,
          topic: marker,
          mimeType: 'text/plain',
          sizeBytes: text.length,
          text,
          pageCount: null,
          needsOcr: false,
          contentHash: `e2e-osnova-v1:${marker}`,
        },
      ],
    },
  })
  expect(imported.ok(), 'zkušební materiál se nepodařilo naimportovat').toBe(true)

  const found = await request.get(`/api/library/search?q=${encodeURIComponent(marker)}`)
  expect(found.ok()).toBe(true)
  const { results } = (await found.json()) as { results: { topicId: string; topicName: string }[] }
  const topic = results.find((result) => result.topicName.includes(marker))
  expect(topic, `zkušební téma „${marker}“ se v knihovně nenašlo`).toBeTruthy()
  return { topicId: topic!.topicId, marker }
}

/** Otázka typu „krátká odpověď“ — na papíře bez vnořeného seznamu možností. */
async function seedShortAnswer(request: APIRequestContext, topicId: string, prompt: string): Promise<void> {
  const created = await request.post('/api/questions', {
    data: {
      topicId,
      question: {
        type: 'short_answer',
        difficulty: 1,
        points: 1,
        blocks: [],
        payload: { prompt, answer: 'odpověď', acceptedAnswers: [] },
      },
    },
  })
  expect(created.ok(), 'zkušební otázku se nepodařilo založit').toBe(true)
}
test.describe('položka osnovy', () => {
  test('u volné odpovědi jde nastavit počet řádků a uloží se s testem', async ({ page }) => {
    await page.goto('/tests/new')

    // Volná odpověď je jediný typ, u kterého má počet řádků smysl. Nehledá se
    // jen v první skupině — pořadí skupin závisí na obsahu databáze a první
    // z nich nemusí volnou odpověď obsahovat vůbec.
    const groups = page.locator('details')
    let openQuestion = groups.first()
    for (let i = 0; i < (await groups.count()); i++) {
      const group = groups.nth(i)
      await group.locator('summary').click()
      const candidate = group.locator('> ul > li').filter({ hasText: 'Volná odpověď' }).first()
      if ((await candidate.count()) > 0) {
        openQuestion = candidate
        break
      }
      await group.locator('summary').click()
    }
    await openQuestion.getByRole('checkbox').click()

    const lines = page.getByLabel('Řádků na odpověď')
    await expect(lines).toBeVisible()
    await lines.fill('9')

    // Název je rovnou v hlavičce skladače.
    await page.getByLabel('Název písemky').fill('Zkouška počtu řádků')
    await page.getByRole('button', { name: 'Uložit' }).click()
    // Po uložení se adresa změní na detail testu (pozor: „/tests/new" by
    // obecnému vzoru taky vyhovělo).
    await page.waitForURL((url) => /\/tests\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'))

    // Načteme uložený test znovu z adresy (ne `reload`: po klientském
    // přesměrování míří obnovení pořád na /tests/new).
    await page.goto(page.url())
    await expect(page.getByLabel('Řádků na odpověď')).toHaveValue('9')
  })
})

/**
 * Skládání písemky: kam se dá nová položka na stránku vložit a jestli se táž
 * otázka smí do testu dostat víckrát.
 */
test.describe('skládání osnovy', () => {
  /**
   * Přidá do prázdné osnovy dvě vlastní otázky, ať výsledek nezávisí na tom,
   * co je v bance z jiných souborů zrovna první — vyhledávací filtr banky
   * zúží skupiny na jedinou, tu vlastní. Třetí otázka tématu zůstává
   * nevybraná: „Vybrat vše" pak má co doplnit, aniž by odznačilo tyhle dvě.
   */
  async function pridejDveOtazky(page: Page) {
    const { topicId, marker } = await seedOsnovaTopic(page.request)
    await seedShortAnswer(page.request, topicId, `${marker}: první otázka`)
    await seedShortAnswer(page.request, topicId, `${marker}: druhá otázka`)
    await seedShortAnswer(page.request, topicId, `${marker}: třetí otázka`)

    await page.goto('/tests/new')
    // Opakované vyplnění (`toPass`): ve WebKitu se stane, že první písmena
    // padnou do políčka dřív, než se stránka v prohlížeči oživí, a filtr
    // banky se pak neprojeví — stejná pojistka jako `hledej` v testy.spec.ts.
    const hledat = page.getByLabel('Hledat')
    const group = page.locator('details')
    await expect(async () => {
      await hledat.fill('')
      await hledat.fill(marker)
      await expect(group).toHaveCount(1, { timeout: 2000 })
    }).toPass({ timeout: 20_000 })

    await group.locator('summary').click()

    const questions = page.locator('details[open] > ul > li')
    await expect(questions).toHaveCount(3)
    await questions.nth(0).getByRole('checkbox').click()
    await questions.nth(1).getByRole('checkbox').click()
    return questions
  }

  test('nadpis části jde vložit před první položku, ne jen na konec', async ({ page }) => {
    await pridejDveOtazky(page)

    // Položky napříč všemi listy: stránka se láme, kde se zlomí PDF.
    const rows = page.locator('[data-slot="paper-sheet"] ol > li')
    // Prokládané vkládací pruhy: 2 otázky = 3 místa k vložení + 2 řádky.
    await expect(rows).toHaveCount(5)

    await page.getByLabel('Vložit před 1. položku').click()
    await page.getByRole('menuitem', { name: 'Nadpis části' }).click()

    // Nadpis je opravdu první položkou stránky, ne poslední. Na papíře je to
    // rovnou nadpis části, ne řádek s odznakem — poznáme ho podle popisku pole.
    await expect(rows.nth(1).getByLabel('Nadpis části')).toHaveValue('Nová část')
    await expect(rows).toHaveCount(7)

    // A pokyn vložený doprostřed skončí mezi oběma otázkami.
    await page.getByLabel('Vložit před 3. položku').click()
    await page.getByRole('menuitem', { name: 'Pokyn' }).click()
    await expect(rows.nth(5).getByLabel('Pokyn k vypracování')).toBeVisible()
  })

  test('vkládací tlačítko se ovládá i klávesnicí', async ({ page }) => {
    await pridejDveOtazky(page)

    const insert = page.getByLabel('Vložit na konec')
    await insert.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: 'Zalomení strany' }).click()

    // Poslední <li> je vkládací pruh na konci, položka je předposlední.
    // Zalomení se na stránce ukazuje jako předěl „nová strana“.
    const rows = page.locator('[data-slot="paper-sheet"] ol > li')
    await expect(rows.nth((await rows.count()) - 2)).toContainText('nová strana')
  })

  test('táž otázka jde do testu zařadit dvakrát a uloží se dvakrát', async ({ page }) => {
    const questions = await pridejDveOtazky(page)
    const prvni = questions.first()
    await expect(prvni.getByText('1\u00d7')).toBeVisible()

    // „Vybrat vše" doplní jen chybějící — už zařazené otázky nesmí zdvojit.
    await page.getByRole('checkbox', { name: 'Vybrat vše', exact: true }).click()
    await expect(prvni.getByText('1\u00d7')).toBeVisible()

    // Otázka, která v testu už je, nabídne zařazení dalšího výskytu na konec.
    await prvni.getByRole('button', { name: 'Zařadit do testu ještě jednou' }).click()
    await expect(prvni.getByText('2\u00d7')).toBeVisible()
    const pocet = await page.getByText(/^Otázek:\s*\d+/).first().textContent()

    await page.getByLabel('Název písemky').fill('Zkouška dvojího použití')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await page.waitForURL((url) => /\/tests\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'))

    // Po znovunačtení musí oba výskyty přežít včetně pořadí — druhý zůstává
    // na konci osnovy, kam se přidal.
    await page.goto(page.url())
    await expect(page.getByText(/^Otázek:\s*\d+/).first()).toHaveText(pocet ?? '')
    const rows = page.locator('[data-slot="paper-sheet"] ol > li')
    await expect(rows.nth(1)).toContainText('1. použití')
    // Předposlední <li>: za poslední položkou je ještě vkládací pruh.
    await expect(rows.nth((await rows.count()) - 2)).toContainText('2. použití')
  })
})
