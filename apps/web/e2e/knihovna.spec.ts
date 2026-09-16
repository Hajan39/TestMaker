import { expect, test, type Page } from '@playwright/test'

/**
 * Ruční správa knihovny: předmět, ročník i téma jde založit a přejmenovat
 * z rozhraní, bez importu souborů. Test si všechno zakládá pod vlastním
 * názvem s časovým razítkem (běží i v chromium i ve webkitu nad touž
 * databází) a na konci po sobě uklidí smazáním předmětu — to je kaskádové,
 * takže s ním zmizí i ročníky a témata.
 */

const RAZITKO = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const PREDMET = `E2E KNIHOVNA ${RAZITKO}`
const PREDMET_NOVY = `E2E Knihovna ${RAZITKO}`
const ROCNIK = `2. ročník ${RAZITKO}`
const ROCNIK_NOVY = `9. ročník ${RAZITKO}`
const ROCNIK_DRUHY = `3. ročník ${RAZITKO}`
const TEMA = `Vlastní téma ${RAZITKO}`
const TEMA_NOVE = `Přepsané téma ${RAZITKO}`

/** Vyplní otevřený dialog a potvrdí ho. Vrací id založené položky, pokud vzniká. */
async function vyplnDialog(page: Page, pole: string, hodnota: string, tlacitko: string) {
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel(pole).fill(hodnota)
  await dialog.getByRole('button', { name: tlacitko, exact: true }).click()
  await expect(dialog).toBeHidden()
}

test.describe('ruční správa knihovny', () => {
  test('založí a přejmenuje předmět, ročník i téma', async ({ page }) => {
    let subjectId: string | null = null

    try {
      await page.goto('/')

      // --- Nový předmět z postranního panelu -------------------------------
      const panel = page.getByRole('complementary', { name: 'Předměty a ročníky' })
      await panel.getByRole('button', { name: 'Nový předmět' }).click()

      const zalozeni = page.waitForResponse(
        (response) => response.url().includes('/api/library') && response.request().method() === 'POST',
      )
      await vyplnDialog(page, 'Název předmětu', PREDMET, 'Založit')
      subjectId = ((await (await zalozeni).json()) as { id: string }).id

      const nadpisPredmetu = page.getByRole('heading', { name: PREDMET, exact: true })
      await expect(nadpisPredmetu).toBeVisible()
      await expect(panel.getByText(PREDMET, { exact: true })).toBeVisible()

      // --- Nový ročník v tom předmětu --------------------------------------
      // `.last()` je nejvnitřnější sekce; panely rozvržení jsou taky `section`.
      const sekce = page.locator('section', { has: nadpisPredmetu }).last()
      await sekce.getByRole('button', { name: 'Nový ročník' }).click()
      await vyplnDialog(page, 'Název ročníku', ROCNIK, 'Založit')

      // Po založení se rovnou přejde do nového ročníku.
      await expect(page).toHaveURL(/\?grade=/)
      await expect(page.getByRole('heading', { name: ROCNIK, exact: true })).toBeVisible()
      const adresaRocniku = page.url()

      // --- Nové téma v ročníku ---------------------------------------------
      await page.getByRole('button', { name: 'Nové téma' }).click()
      await vyplnDialog(page, 'Název tématu', TEMA, 'Založit')

      // A rovnou se otevře, aby se do něj dalo psát.
      await expect(page).toHaveURL(/\/topics\//)
      await expect(page.getByRole('heading', { name: TEMA, exact: true })).toBeVisible()
      // Téma bez materiálů nesmí přehled rozbít — počty jsou prostě nulové.
      await expect(page.getByText('materiálů', { exact: false }).first()).toBeVisible()

      // --- Přejmenování tématu (na místě, bez dialogu) ---------------------
      await page.goto(adresaRocniku)
      await expect(page.getByText(TEMA, { exact: true }).first()).toBeVisible()
      await page.getByRole('button', { name: 'Přejmenovat téma' }).first().click()
      const poleTematu = page.getByRole('textbox', { name: 'Přejmenovat téma' })
      await poleTematu.fill(TEMA_NOVE)
      await poleTematu.press('Enter')
      await expect(page.getByText(TEMA_NOVE, { exact: true }).first()).toBeVisible()
      await expect(page.getByText(TEMA, { exact: true })).toHaveCount(0)

      // --- Přejmenování ročníku --------------------------------------------
      await page.getByRole('button', { name: 'Přejmenovat ročník' }).click()
      await vyplnDialog(page, 'Název ročníku', ROCNIK_NOVY, 'Uložit')
      await expect(page.getByRole('heading', { name: ROCNIK_NOVY, exact: true })).toBeVisible()
      // Změna se propíše i do postranního panelu.
      await expect(panel.getByText(ROCNIK_NOVY, { exact: true })).toBeVisible()

      // --- Dva ročníky téhož jména to odmítne a řekne proč ------------------
      await panel.getByText(PREDMET, { exact: true }).waitFor()
      const blokPredmetu = panel.locator('div').filter({ hasText: PREDMET }).first()
      await blokPredmetu.getByRole('button', { name: 'Nový ročník' }).click()
      await vyplnDialog(page, 'Název ročníku', ROCNIK_DRUHY, 'Založit')
      await expect(page.getByRole('heading', { name: ROCNIK_DRUHY, exact: true })).toBeVisible()

      await page.getByRole('button', { name: 'Přejmenovat ročník' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Název ročníku').fill(ROCNIK_NOVY)
      await dialog.getByRole('button', { name: 'Uložit', exact: true }).click()
      await expect(dialog).toContainText('už je')
      await expect(dialog).toContainText('Upravit skupinu')
      await dialog.getByRole('button', { name: 'Zrušit' }).click()
      await expect(page.getByRole('heading', { name: ROCNIK_DRUHY, exact: true })).toBeVisible()

      // --- Přejmenování předmětu -------------------------------------------
      await page.goto('/')
      const sekceZnovu = page.locator('section', { has: nadpisPredmetu }).last()
      await sekceZnovu.getByRole('button', { name: 'Přejmenovat předmět' }).click()
      await vyplnDialog(page, 'Název předmětu', PREDMET_NOVY, 'Uložit')

      await expect(page.getByRole('heading', { name: PREDMET_NOVY, exact: true })).toBeVisible()
      await expect(nadpisPredmetu).toHaveCount(0)
    } finally {
      // Úklid i po spadlém testu: s předmětem zmizí ročníky i témata.
      if (subjectId) {
        const smazano = await page.request.delete(
          `/api/library?kind=subject&id=${encodeURIComponent(subjectId)}`,
        )
        expect(smazano.ok(), 'zkušební předmět se nepodařilo uklidit').toBe(true)
      }
    }
  })
})
