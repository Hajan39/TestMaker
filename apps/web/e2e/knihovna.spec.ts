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

      // --- Nový předmět z úvodu -------------------------------------------
      await page.getByRole('button', { name: 'Založit předmět' }).click()

      const zalozeni = page.waitForResponse(
        (response) => response.url().includes('/api/library') && response.request().method() === 'POST',
      )
      await vyplnDialog(page, 'Název předmětu', PREDMET, 'Založit')
      subjectId = ((await (await zalozeni).json()) as { id: string }).id

      const nadpisPredmetu = page.getByRole('heading', { name: PREDMET, exact: true })
      await expect(nadpisPredmetu).toBeVisible()

      // --- Nový ročník v tom předmětu --------------------------------------
      // `.last()` je nejvnitřnější sekce; panely rozvržení jsou taky `section`.
      const sekce = page.locator('section', { has: nadpisPredmetu }).last()
      await sekce.getByRole('button', { name: 'Nový ročník' }).click()
      await vyplnDialog(page, 'Název ročníku', ROCNIK, 'Založit')

      // Po založení se rovnou přejde do nové třídy.
      await expect(page).toHaveURL(/\/tridy\//)
      await expect(page.getByRole('heading', { name: ROCNIK, exact: true })).toBeVisible()
      const adresaTridy = page.url()

      // --- Nové téma v ročníku ---------------------------------------------
      await page.getByRole('button', { name: 'Přidat téma' }).click()
      await vyplnDialog(page, 'Název tématu', TEMA, 'Založit')

      // A rovnou se otevře, aby se do něj dalo psát.
      await expect(page).toHaveURL(/\/topics\//)
      await expect(page.getByRole('heading', { name: TEMA, exact: true })).toBeVisible()
      // Téma bez materiálů nesmí přehled rozbít — počty jsou prostě nulové.
      await expect(page.getByText('materiálů', { exact: false }).first()).toBeVisible()

      // --- Přejmenování tématu (na místě, bez dialogu) ---------------------
      await page.goto(adresaTridy)
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

      // Změna se propíše i do dlaždice na úvodu. Stejné jméno teď nese i
      // odkaz v postranním panelu, proto se hledá jen v obsahové ploše.
      await page.goto('/?vse=1')
      const obsahUvodu = page.getByRole('region', { name: 'Třídy' })
      await expect(obsahUvodu.getByText(ROCNIK_NOVY, { exact: false })).toBeVisible()

      // --- Dva ročníky téhož jména to odmítne a řekne proč ------------------
      const nadpisPredmetuZnovu = page.getByRole('heading', { name: PREDMET, exact: true })
      await expect(nadpisPredmetuZnovu).toBeVisible()
      const sekceDruha = page.locator('section', { has: nadpisPredmetuZnovu }).last()
      await sekceDruha.getByRole('button', { name: 'Nový ročník' }).click()
      await vyplnDialog(page, 'Název ročníku', ROCNIK_DRUHY, 'Založit')
      await expect(page).toHaveURL(/\/tridy\//)
      await expect(page.getByRole('heading', { name: ROCNIK_DRUHY, exact: true })).toBeVisible()

      await page.getByRole('button', { name: 'Přejmenovat ročník' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByLabel('Název ročníku').fill(ROCNIK_NOVY)
      await dialog.getByRole('button', { name: 'Uložit', exact: true }).click()
      await expect(dialog).toContainText('už je')
      await expect(dialog).toContainText('Upravit téma')
      await dialog.getByRole('button', { name: 'Zrušit' }).click()
      await expect(page.getByRole('heading', { name: ROCNIK_DRUHY, exact: true })).toBeVisible()

      // --- Přejmenování předmětu -------------------------------------------
      // `?vse=1`, jinak by úvod přesměroval rovnou na naposledy otevřenou třídu.
      await page.goto('/?vse=1')
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
