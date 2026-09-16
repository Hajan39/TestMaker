import { expect, test, type Page } from '@playwright/test'

/**
 * Stránka písemky ve skladači: náhled a obsah testu v jedné ploše. Otázka se
 * na ní vykresluje tak, jak se vytiskne, dá se na ní přesouvat i odebírat a
 * stránky se lámou tam, kde je zlomí PDF.
 *
 * Pracuje se se seedovaným tématem „Měkkýši“ (viz `scripts/seed-e2e.ts`) —
 * má otázky všech běžných typů a v bance se dá vyfiltrovat hledáním.
 */

const TEMA = 'Měkkýši'

/** Otevře prázdný skladač, vyfiltruje téma a zaškrtne prvních `kolik` otázek. */
async function pridejOtazky(page: Page, kolik: number) {
  await page.goto('/tests/new')

  // Vyplnění hledání se opakuje, dokud ho stránka udrží: v Safari stihne
  // přijít dřív než hydratace a React ho pak přepíše zpět na prázdné.
  const search = page.getByLabel('Hledat')
  await expect
    .poll(async () => {
      await search.fill(TEMA)
      return search.inputValue()
    }, { message: 'hledání v bance se nevyplnilo' })
    .toBe(TEMA)

  const topic = page.locator('details').filter({ hasText: TEMA }).first()
  await topic.locator('summary').click()
  const questions = topic.locator('> ul > li')
  await expect(questions).toHaveCount(4)
  for (let i = 0; i < kolik; i += 1) {
    await questions.nth(i).getByRole('checkbox').click()
  }
  return questions
}

const sheets = (page: Page) => page.locator('[data-slot="paper-sheet"]')

test.describe('stránka písemky', () => {
  test('přidaná otázka se objeví na listu v tištěné podobě', async ({ page }) => {
    await pridejOtazky(page, 3)

    const list = sheets(page).first()
    await expect(list).toBeVisible()

    // Hlavička testu se tiskne na první straně: linky k vyplnění a políčko na body.
    await expect(list.getByText('Jméno a příjmení:')).toBeVisible()
    await expect(list.getByText(/Body: ______/)).toBeVisible()

    // Výběr jedné možnosti: číslo otázky, zadání a možnosti písmeny.
    const vyber = list.getByRole('listitem').filter({ hasText: 'která odpověď je správná' }).first()
    await expect(vyber).toContainText('1.')
    await expect(vyber).toContainText('A)')
    await expect(vyber).toContainText('B)')
    await expect(vyber).toContainText('Druhá možnost')

    // Pravda/nepravda je tabulka se sloupci ANO a NE.
    await expect(list.getByRole('table')).toContainText('ANO')
    await expect(list.getByRole('table')).toContainText('NE')

    // Volná odpověď má skutečné linky na psaní (výchozí čtyři).
    await expect(list.locator('[data-slot="paper-line"]')).toHaveCount(4)

    // Klíč se do papíru nekreslí: vzorová odpověď na listu není.
    await expect(list.getByText('Odpověď vlastními slovy.')).toHaveCount(0)
  })

  test('vzorovou odpověď ukáže až tlačítko Řešení a označí ji za netisknutelnou', async ({ page }) => {
    await pridejOtazky(page, 3)

    // Jen položky na listu — táž otázka je vidět i v bance vlevo.
    const volna = page
      .locator('[data-slot="paper-sheet"] ol > li')
      .filter({ hasText: 'vysvětli vlastními slovy' })
      .first()
    await volna.hover()
    await volna.getByRole('button', { name: 'Řešení' }).click()

    const reseni = page.locator('[data-slot="reseni"]')
    await expect(reseni).toBeVisible()
    await expect(reseni).toContainText('Vzorová odpověď (netiskne se)')
    await expect(reseni).toContainText('Odpověď vlastními slovy.')

    // Druhé kliknutí ji zase schová — na papíře nemá co dělat.
    await volna.getByRole('button', { name: 'Řešení' }).click()
    await expect(reseni).toHaveCount(0)
  })

  test('položka se přetáhne klávesnicí a jde odebrat', async ({ page }) => {
    await pridejOtazky(page, 2)

    const rows = page.locator('[data-slot="paper-sheet"] ol > li')
    /** Zadání otázek v tom pořadí, v jakém jsou na listu. */
    const poradi = async () => {
      const texts = await rows.allInnerTexts()
      return texts.filter((t) => t.includes('Měkkýši:')).map((t) => t.split('\n')[0])
    }

    const pred = await poradi()
    expect(pred).toHaveLength(2)

    // Přetažení klávesnicí: mezerník úchyt chytne, šipka posune, mezerník pustí.
    const handle = rows
      .filter({ hasText: pred[0]! })
      .first()
      .getByRole('button', { name: 'Přetáhnout pro změnu pořadí' })
    await handle.focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Space')

    await expect.poll(poradi, { message: 'pořadí se nezměnilo' }).toEqual([pred[1], pred[0]])

    // Odebrání zmizí z listu i ze souhrnu pod ním.
    const summary = page.locator('dl').filter({ hasText: 'Odhad stran:' })
    await expect(summary).toContainText('Otázek: 2')
    const prvni = rows.filter({ hasText: pred[1]! }).first()
    await prvni.hover()
    await prvni.getByRole('button', { name: 'Odebrat' }).click()
    await expect(summary).toContainText('Otázek: 1')
    await expect.poll(poradi).toEqual([pred[0]])
  })

  test('počet stran na obrazovce odpovídá počtu stran ve staženém PDF', async ({ page, request }) => {
    await pridejOtazky(page, 2)

    // Jeden list, dokud se písemka nezalomí.
    await expect(sheets(page)).toHaveCount(1)

    // Zalomení mezi otázky udělá druhou stranu.
    await page.getByLabel('Vložit před 2. položku').click()
    await page.getByRole('menuitem', { name: 'Zalomení strany' }).click()
    await expect(sheets(page)).toHaveCount(2)
    await expect(page.locator('dl').filter({ hasText: 'Odhad stran:' })).toContainText('Odhad stran: 2')

    await page.getByLabel('Název písemky').fill('Zkouška počtu stran')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await page.waitForURL((url) => /\/tests\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'))
    const testId = new URL(page.url()).pathname.split('/').pop()!

    // Zadání pro žáky (bez klíče) — to je to, co stránka ukazuje.
    const pdf = await request.get(`/api/tests/${testId}/pdf?variant=A`)
    expect(pdf.ok(), 'PDF se nepodařilo stáhnout').toBe(true)
    const body = (await pdf.body()).toString('latin1')
    const stran = (body.match(/\/Type\s*\/Page[^s]/g) ?? []).length

    const naObrazovce = await sheets(page).count()
    expect(stran, 'PDF má jiný počet stran než stránka ve skladači').toBe(naObrazovce)

    await request.delete(`/api/tests?id=${testId}`)
  })
})
