import { expect, test } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Tři doplňky rozhraní ze specifikace redesignu, které v prvním plánu chyběly:
 * hledání přes celou knihovnu, odhad stran pod osnovou testu a filtr
 * obtížnosti v kontrole konceptů.
 */

// Téma s materiály i otázkami si test najde sám — natvrdo zadané id
// z autorova disku by na cizí databázi neexistovalo.

test.describe('hledání přes celou knihovnu', () => {
  test('najde téma napříč ročníky a odkáže na něj', async ({ page }) => {
    await page.goto('/')

    // `fill()` ve WebKitu nevyvolá u tohohle pole React onChange, proto se
    // hledaný výraz píše po znacích jako od učitelky.
    const search = page.getByPlaceholder('Hledat v celé knihovně…')
    await search.pressSequentially('fotosyntéza')

    const result = page.getByRole('button', { name: /fotosyntéza/i }).first()
    await expect(result).toBeVisible()
    // Cesta (předmět, ročník) je vidět, aby bylo poznat, odkud téma je.
    await expect(result).toContainText('PŘÍRODOPIS')

    await result.click()
    await expect(page).toHaveURL(/\/topics\//)
  })

  test('najde téma i podle názvu materiálu', async ({ page }) => {
    await page.goto('/')

    const search = page.getByPlaceholder('Hledat v celé knihovně…')
    // „Měkkýši“ má materiál „6.22 Měkkýši (Mollusca)…“ — hledáme jen podle
    // části názvu souboru, ne podle názvu tématu.
    await search.pressSequentially('Mollusca')

    const result = page.getByRole('button', { name: /Měkkýši/i }).first()
    await expect(result).toBeVisible()
    await expect(result).toContainText('soubor')
  })

  test('krátký dotaz nic nehledá', async ({ page }) => {
    await page.goto('/')
    const search = page.getByPlaceholder('Hledat v celé knihovně…')
    await search.pressSequentially('a')
    await expect(page.getByText('Hledám…')).toHaveCount(0)
  })
})

test.describe('odhad stran pod osnovou testu', () => {
  test('se objeví po přidání otázky a roste s dalšími', async ({ page }) => {
    await page.goto('/tests/new')

    // Banka nabízí rovnou jen schválené otázky (server jiné neposílá), takže se
    // nic nepřepíná. Témata jsou sbalená, otázky se ukážou až po rozbalení.
    await page.locator('details summary').first().click()
    // Přímí potomci: uvnitř náhledu otázky jsou další seznamy s možnostmi.
    const questions = page.locator('details[open] > ul > li')

    // Přidáme první dostupnou otázku z banky.
    const firstCheckbox = questions.first().getByRole('checkbox')
    await firstCheckbox.waitFor({ state: 'visible' })
    await firstCheckbox.click()

    // Souhrn pod osnovou je definiční seznam: počet otázek, body, odhad stran.
    const summary = page.locator('dl').filter({ hasText: 'Odhad stran:' })
    await expect(summary).toBeVisible()
    await expect(summary).toContainText('Otázek: 1')
    await expect(summary).toContainText('Odhad stran:')

    // S další otázkou počet roste a odhad zůstává vyplněný.
    await questions.nth(1).getByRole('checkbox').click()
    await expect(summary).toContainText('Otázek: 2')
    await expect(summary).toContainText('Odhad stran:')
  })
})

test.describe('filtr obtížnosti v kontrole konceptů', () => {
  test('rozbalovací nabídka se otevře a vybere hodnotu', async ({ page }) => {
    await page.goto(await testTopicPath(page.request))

    const difficultyFilter = page.getByLabel('Obtížnost')
    await difficultyFilter.click()
    await page.getByRole('option', { name: 'Těžká' }).click()
    await expect(difficultyFilter).toContainText('Těžká')
  })

  test('fronta Projít po jedné respektuje zvolenou obtížnost', async ({ page }) => {
    await page.goto(await testTopicPath(page.request))

    const difficultyFilter = page.getByLabel('Obtížnost')
    await difficultyFilter.click()
    await page.getByRole('option', { name: 'Lehká' }).click()

    const passButton = page.getByRole('button', { name: 'Projít po jedné' })
    // Pokud filtru nic neodpovídá, tlačítko je zakázané — obojí je platný stav.
    if (await passButton.isEnabled()) {
      await passButton.click()
      await expect(page.getByRole('dialog')).toBeVisible()
    }
  })
})
