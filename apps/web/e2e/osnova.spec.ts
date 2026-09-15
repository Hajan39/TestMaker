import { expect, test } from '@playwright/test'

/**
 * Osnova testu: co jde u jednotlivé položky nastavit jen pro tenhle test,
 * aniž by se měnila otázka v bance.
 */
test.describe('položka osnovy', () => {
  test('u volné odpovědi jde nastavit počet řádků a uloží se s testem', async ({ page }) => {
    await page.goto('/tests/new')
    await page.getByText('jen schválené').click()
    await page.locator('details summary').first().click()

    // Najdeme volnou odpověď — jen ta má v testu smysl u počtu řádků.
    const openQuestion = page
      .locator('details[open] > ul > li')
      .filter({ hasText: 'Volná odpověď' })
      .first()
    await openQuestion.getByRole('checkbox').click()

    const lines = page.getByLabel('Řádků na odpověď')
    await expect(lines).toBeVisible()
    await lines.fill('9')

    // Název je v postranním panelu s nastavením testu.
    await page.getByRole('button', { name: 'Nastavení' }).click()
    await page.getByLabel('Název testu').fill('Zkouška počtu řádků')
    await page.keyboard.press('Escape')
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
 * Skládání osnovy: kam se dá nová položka vložit a jestli se táž otázka
 * smí do testu dostat víckrát.
 */
test.describe('skládání osnovy', () => {
  /** Přidá do prázdné osnovy dvě různé otázky z první rozbalené skupiny. */
  async function pridejDveOtazky(page: import('@playwright/test').Page) {
    await page.goto('/tests/new')
    await page.getByText('jen schválené').click()
    await page.locator('details summary').first().click()
    const questions = page.locator('details[open] > ul > li')
    await questions.first().getByRole('checkbox').click()
    await questions.nth(1).getByRole('checkbox').click()
    return questions
  }

  test('nadpis části jde vložit před první položku, ne jen na konec', async ({ page }) => {
    await pridejDveOtazky(page)

    const outline = page.locator('ol').filter({ has: page.getByLabel('Vložit na konec') })
    const rows = outline.locator('> li')
    // Prokládané vkládací pruhy: 2 otázky = 3 místa k vložení + 2 řádky.
    await expect(rows).toHaveCount(5)

    await page.getByLabel('Vložit před 1. položku').click()
    await page.getByRole('menuitem', { name: 'Nadpis části' }).click()

    // Nadpis je opravdu první položkou osnovy, ne poslední.
    const texts = outline.getByRole('textbox')
    await expect(texts.first()).toHaveValue('Nová část')
    await expect(rows.nth(1)).toContainText('nadpis části')
    await expect(rows).toHaveCount(7)

    // A pokyn vložený doprostřed skončí mezi oběma otázkami.
    await page.getByLabel('Vložit před 3. položku').click()
    await page.getByRole('menuitem', { name: 'Pokyn' }).click()
    await expect(rows.nth(5)).toContainText('pokyn')
  })

  test('vkládací tlačítko se ovládá i klávesnicí', async ({ page }) => {
    await pridejDveOtazky(page)

    const insert = page.getByLabel('Vložit na konec')
    await insert.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: 'Zalomení strany' }).click()

    // Poslední <li> je vkládací pruh na konci, položka je předposlední.
    const rows = page.locator('ol').filter({ has: insert }).locator('> li')
    await expect(rows.nth((await rows.count()) - 2)).toContainText('zalomení strany')
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

    await page.getByRole('button', { name: 'Nastavení' }).click()
    await page.getByLabel('Název testu').fill('Zkouška dvojího použití')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await page.waitForURL((url) => /\/tests\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'))

    // Po znovunačtení musí oba výskyty přežít včetně pořadí — druhý zůstává
    // na konci osnovy, kam se přidal.
    await page.goto(page.url())
    await expect(page.getByText(/^\d+ otázek/).first()).toHaveText(pocet ?? '')
    const rows = page.locator('ol').filter({ has: page.getByLabel('Vložit na konec') }).locator('> li')
    await expect(rows.nth(1)).toContainText('1. použití')
    // Předposlední <li>: za poslední položkou je ještě vkládací pruh.
    await expect(rows.nth((await rows.count()) - 2)).toContainText('2. použití')
  })
})
