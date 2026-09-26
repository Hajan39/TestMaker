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
})
