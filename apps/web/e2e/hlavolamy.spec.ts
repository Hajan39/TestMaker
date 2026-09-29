import { expect, test, type Page } from '@playwright/test'

/**
 * Obrazovka hlavolamů: napsat slova ručně, vidět mřížku v náhledu, uložit
 * a vytisknout.
 *
 * Model se odsud nikdy nevolá — testy hlídají, že na `/api/puzzles/words`
 * nešel ani jeden požadavek. Slovní zásoba od modelu se ověřuje jednotkovými
 * testy s podvrženým voláním (`apps/web/test/puzzles.test.ts`).
 */

const SLOVA: [string, string][] = [
  ['kořen', 'Poutá rostlinu v půdě'],
  ['stonek', 'Nese listy a květy'],
  ['list', 'Probíhá v něm fotosyntéza'],
  ['plod', 'Vzniká z květu'],
]

/**
 * Vyplní název. Píše se až po přidání slov: dokud stránka nedokončí
 * hydrataci, React o napsaném textu neví a při uložení by se hlavolam
 * jmenoval „Hlavolam“ (ve Webkitu se to stávalo spolehlivě).
 */
async function napisNazev(page: Page, nazev: string): Promise<void> {
  const pole = page.getByLabel('Název')
  await pole.fill(nazev)
  await expect(pole).toHaveValue(nazev)
}

/** Napíše slova do seznamu; každé si nejdřív vyžádá prázdný řádek. */
async function napisSlova(page: Page, slova: [string, string][]): Promise<void> {
  for (const [index, [slovo, napoveda]] of slova.entries()) {
    await page.getByRole('button', { name: 'Přidat slovo' }).click()
    // Přesný popisek: nabídka akcí u řádku se jmenuje „Akce pro slovo 1“
    // a volnému hledání podle popisku by se do cesty pletla.
    await page.getByRole('textbox', { name: `Slovo ${index + 1}`, exact: true }).fill(slovo)
    await page.getByRole('textbox', { name: `Nápověda ${index + 1}`, exact: true }).fill(napoveda)
  }
}

test.describe('hlavolamy', () => {
  test('osmisměrka z ručně napsaných slov se ukáže v náhledu a uloží', async ({ page }) => {
    const volaniModelu: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/puzzles/words')) volaniModelu.push(request.url())
    })

    const nazev = `E2E osmisměrka ${Date.now()}`
    await page.goto('/hlavolamy')
    await napisSlova(page, SLOVA)
    await napisNazev(page, nazev)

    // Náhled je papír: mřížka se musí objevit hned, bez ukládání.
    const mrizka = page.locator('[data-slot="puzzle-grid"]')
    await expect(mrizka).toBeVisible()
    await expect(page.locator('[data-slot="puzzle-words"] li').first()).toHaveText(/KOŘEN/)

    // Zadaná velikost mřížky platí: 12 × 12 buněk.
    await expect(mrizka.locator('> div')).toHaveCount(12)
    await expect(mrizka.locator('> div').first().locator('span')).toHaveCount(12)

    await page.getByRole('button', { name: 'Uložit hlavolam' }).click()
    await expect(page.locator('[data-slot="puzzle-list"]').getByText(nazev)).toBeVisible()

    expect(volaniModelu, 'model se z obrazovky volat nesmí').toEqual([])
  })

  test('menší mřížka ohlásí slovo, které se do ní nevejde', async ({ page }) => {
    await page.goto('/hlavolamy')
    await napisSlova(page, [
      ['fotosyntéza', 'Děj v zelených listech'],
      ['list', 'Probíhá v něm fotosyntéza'],
    ])
    await napisNazev(page, 'E2E malá mřížka')
    await page.getByLabel('Sloupce').fill('6')
    await page.getByLabel('Řádky').fill('6')

    // Tiché vynechání by znamenalo, že žák hledá slovo, které v mřížce není.
    await expect(page.locator('[data-slot="puzzle-problems"]')).toContainText('nevejde')
  })

  test('tajenka ukáže řádky i řešení a dá se vytisknout', async ({ page }) => {
    const volaniModelu: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/puzzles/words')) volaniModelu.push(request.url())
    })

    const nazev = `E2E tajenka ${Date.now()}`
    await page.goto('/hlavolamy')
    await page.getByLabel('Druh hlavolamu').click()
    await page.getByRole('option', { name: 'Tajenka' }).click()
    await napisSlova(page, SLOVA)
    await napisNazev(page, nazev)
    await page.getByLabel('Tajená věta').fill('les')

    // Tři písmena tajenky = tři řádky s nápovědou. Počítají se přímo řádky
    // mřížky (`data-slot="puzzle-row"`), ne všechny přímé děti obalu — ten
    // má navíc řádek s tajenkou a popisky „Doplňovačka“/„Otázky“, které by
    // počet přebily.
    const radky = page.locator('[data-slot="puzzle-row"]')
    await expect(radky).toHaveCount(3)

    // Řešení ukáže, co má vyjít — prázdná políčka se vyplní.
    await page.getByText('Ukázat řešení').click()
    await expect(page.locator('[data-slot="puzzle-rows"]')).toContainText('L')

    const tisk = page.waitForResponse(
      (response) => response.url().includes('/api/puzzles/') && response.url().includes('/pdf'),
    )
    await page.getByRole('button', { name: 'Vytisknout', exact: true }).click()
    expect((await tisk).status()).toBe(200)

    expect(volaniModelu, 'model se z obrazovky volat nesmí').toEqual([])
  })

  test('rozbitý hlavolam se uloží jako rozpracovaný, ale tisk a zařazení jsou zamčené', async ({ page }) => {
    const nazev = `E2E rozbitá ${Date.now()}`
    await page.goto('/hlavolamy')
    await napisSlova(page, [
      ['fotosyntéza', 'Děj v zelených listech'],
      ['list', 'Probíhá v něm fotosyntéza'],
    ])
    await napisNazev(page, nazev)
    await page.getByLabel('Sloupce').fill('6')
    await page.getByLabel('Řádky').fill('6')
    await expect(page.locator('[data-slot="puzzle-problems"]')).toContainText('nevejde')

    // Tisk i zařazení jsou zamčené a je u nich napsané proč.
    await expect(page.getByRole('button', { name: 'Vytisknout', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Vytisknout s řešením' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Zařadit do písemky' })).toBeDisabled()
    await expect(page.locator('[data-slot="puzzle-blocked"]')).toContainText('opravíš potíže')

    // Uložit jako rozpracovaný jde, jen se řekne, že tisknout se zatím nedá.
    await page.getByRole('button', { name: 'Uložit hlavolam' }).click()
    await expect(page.getByText('zatím se nedá vytisknout ani zařadit do písemky')).toBeVisible()
    await expect(page.locator('[data-slot="puzzle-list"]').getByText(nazev)).toBeVisible()
  })

  test('slovo bez nápovědy nezmizí potichu a rozsah polí se hlídá', async ({ page }) => {
    await page.goto('/hlavolamy')
    await page.getByLabel('Druh hlavolamu').click()
    await page.getByRole('option', { name: 'Tajenka' }).click()
    await napisSlova(page, [
      ['kořen', 'Poutá rostlinu v půdě'],
      ['stonek', ''],
      ['list', 'Probíhá v něm fotosyntéza'],
    ])
    await napisNazev(page, 'E2E bez nápovědy')

    // Řádek zůstal v seznamu a je u něj napsané, co doplnit.
    await expect(page.getByRole('textbox', { name: 'Slovo 2', exact: true })).toHaveValue('stonek')
    const potiz = page.locator('[data-slot="puzzle-entry-problem"]')
    await expect(potiz).toHaveCount(1)
    await expect(potiz).toContainText('Doplň nápovědu')
    await expect(page.locator('[data-slot="puzzle-missing"]')).toContainText('Oprav řádek')

    // Příliš dlouhé slovo se ohlásí se skutečnou mezí, ne obecnou hláškou.
    await page.getByRole('textbox', { name: 'Slovo 3', exact: true }).fill('a'.repeat(30))
    await expect(potiz.nth(1)).toContainText('nejvýš 24')
  })

  test('rozměr mřížky jde přepsat a mimo meze se srovná', async ({ page }) => {
    await page.goto('/hlavolamy')
    const sloupce = page.getByLabel('Sloupce')
    await sloupce.fill('')
    await expect(sloupce).toHaveValue('')
    await sloupce.pressSequentially('15')
    await expect(sloupce).toHaveValue('15')
    await sloupce.fill('50')
    await sloupce.blur()
    await expect(sloupce).toHaveValue('20')
  })

  test('mazání i zahození změn se nejdřív zeptá', async ({ page }) => {
    const nazev = `E2E mazání ${Date.now()}`
    await page.goto('/hlavolamy')
    await napisSlova(page, SLOVA)
    await napisNazev(page, nazev)
    await page.getByRole('button', { name: 'Uložit hlavolam' }).click()
    const radek = page.locator('[data-slot="puzzle-list"] li').filter({ hasText: nazev })
    await expect(radek).toBeVisible()

    // Neuložená změna: nový hlavolam ji bez ptaní nezahodí.
    await page.getByLabel('Název').fill(`${nazev} upravený`)
    await page.getByRole('button', { name: 'Nový hlavolam' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect(dialog).toContainText('Zahodit neuložené změny?')
    await dialog.getByRole('button', { name: 'Nechat být' }).click()
    await expect(page.getByLabel('Název')).toHaveValue(`${nazev} upravený`)

    // Mazání se ptá; „Nechat být" hlavolam nechá v knihovně.
    await radek.getByRole('button', { name: /Akce pro hlavolam/ }).click()
    await page.getByRole('menuitem', { name: 'Smazat' }).click()
    await expect(dialog).toContainText(`Smazat hlavolam „${nazev}"?`)
    await dialog.getByRole('button', { name: 'Nechat být' }).click()
    await expect(radek).toBeVisible()

    await radek.getByRole('button', { name: /Akce pro hlavolam/ }).click()
    await page.getByRole('menuitem', { name: 'Smazat' }).click()
    await dialog.getByRole('button', { name: 'Smazat hlavolam' }).click()
    // Delší čekání: vývojový server cestu DELETE při prvním volání teprve překládá.
    await expect(radek).toHaveCount(0, { timeout: 20_000 })
  })

  /**
   * Vytažení slov se zkouší jen tam, kde je model nastavený (tlačítko je
   * vidět) — v běžném běhu testů není a test se přeskočí. Pustit ho jde
   * s vymyšleným klíčem, např.
   * `AI_MODELS=google:x GOOGLE_GENERATIVE_AI_API_KEY=e2e pnpm exec playwright test e2e/hlavolamy.spec.ts`;
   * odpověď na `/api/puzzles/words` je stejně podvržená, model se nevolá.
   */
  test('když model nedodá slova, rozhraní to neoznámí jako úspěch', async ({ page }) => {
    await page.route('**/api/puzzles/words**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { entries: [] } })
        return
      }
      await route.fulfill({
        json: { entries: [], rejected: [], models: ['google:x'], requested: 12, returned: 0, dropped: 0 },
      })
    })
    await page.goto('/hlavolamy')
    const vytahnout = page.getByRole('button', { name: 'Vytáhnout slova z materiálů' })
    test.skip(!(await vytahnout.isVisible()), 'Model není v testovacím serveru nastavený.')

    await page.getByLabel('Téma').click()
    await page.getByRole('option').nth(1).click()
    await vytahnout.click()
    await expect(page.getByText('Model nedodal žádné nové slovo.')).toBeVisible()

    // Málo slov proti požadavku je varování s radou, ne zelený úspěch.
    await page.unroute('**/api/puzzles/words**')
    await page.route('**/api/puzzles/words**', async (route) => {
      await route.fulfill({
        json: {
          entries: [
            { word: 'kořen', clue: 'Poutá rostlinu v půdě' },
            { word: 'list', clue: 'Zelený orgán' },
          ],
          rejected: [],
          models: ['google:x'],
        },
      })
    })
    await vytahnout.click()
    await expect(page.getByText('Přibylo jen 2 slova z 12 požadovaných.')).toBeVisible()
  })
})
