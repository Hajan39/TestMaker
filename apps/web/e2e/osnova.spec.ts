import { expect, test } from '@playwright/test'

/**
 * Položka na stránce písemky: co jde nastavit jen pro tenhle test, aniž by se
 * měnila otázka v bance. Ovládání položky (body, řádky, odebrání) se vynoří
 * u okraje listu, když je položka pod myší nebo v ní stojí ohnisko.
 */
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
  /** Přidá do prázdné osnovy dvě různé otázky z první rozbalené skupiny. */
  async function pridejDveOtazky(page: import('@playwright/test').Page) {
    await page.goto('/tests/new')
    await page.locator('details summary').first().click()
    const questions = page.locator('details[open] > ul > li')
    await questions.first().getByRole('checkbox').click()
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
    const pocet = await page.getByText(/^\d+ otázek/).first().textContent()

    await page.getByLabel('Název písemky').fill('Zkouška dvojího použití')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await page.waitForURL((url) => /\/tests\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'))

    // Po znovunačtení musí oba výskyty přežít včetně pořadí — druhý zůstává
    // na konci osnovy, kam se přidal.
    await page.goto(page.url())
    await expect(page.getByText(/^\d+ otázek/).first()).toHaveText(pocet ?? '')
    const rows = page.locator('[data-slot="paper-sheet"] ol > li')
    await expect(rows.nth(1)).toContainText('1. použití')
    // Předposlední <li>: za poslední položkou je ještě vkládací pruh.
    await expect(rows.nth((await rows.count()) - 2)).toContainText('2. použití')
  })
})
