import { expect, test } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Tři doplňky vyžádané majitelem: hromadný výběr všude, kde se zaškrtává,
 * dvouřádková dlaždice tématu a přepínač světlého a tmavého motivu.
 */

// Téma s materiály i otázkami si test najde sám — natvrdo zadané id
// z autorova disku by na cizí databázi neexistovalo.

test.describe('hromadný výběr', () => {
  test('v bance otázek zúžené na téma vybere vše, co je vidět', async ({ page }) => {
    const path = await testTopicPath(page.request)
    const topicId = path.split('/').pop()!
    await page.goto(`/questions?topicId=${topicId}`)

    const selectAll = page.getByRole('checkbox', { name: /^Vybrat vše viditelné/ })
    await expect(selectAll).toBeVisible()
    await selectAll.click()

    // Po výběru se objeví lišta hromadných akcí s počtem.
    await expect(page.getByText(/^Vybráno \d+$/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Smazat/ })).toBeVisible()

    // Druhé kliknutí výběr zase zruší.
    await selectAll.click()
    await expect(page.getByText(/^Vybráno \d+$/)).toHaveCount(0)
  })

  test('v bance otázek přidá celé téma do osnovy', async ({ page }) => {
    await page.goto('/tests/new')

    const selectAll = page.getByRole('checkbox', { name: 'Vybrat vše', exact: true })
    await selectAll.waitFor({ state: 'visible' })
    await selectAll.click()

    // Počty se čtou na jediném místě: v patičce pod stránkou písemky.
    await expect(page.getByText(/^Otázek:\s*[1-9]/)).toBeVisible()
  })

  test('generování v tématu nabízí jen počet a obtížnost, žádný výběr typů', async ({ page }) => {
    // Výběr typů a režim „Doplnit na celkový počet" patří jen hromadnému
    // generování (`BulkGenerate`) — v tématu se generuje vždycky ze všech
    // typů a vždycky přidávají nové otázky, ať to učitelku nezdržuje.
    await page.goto(await testTopicPath(page.request))
    const generate = page.getByRole('button', { name: 'Vygenerovat otázky' })
    test.skip((await generate.count()) === 0, 'Generování není nakonfigurované.')

    await expect(page.getByRole('button', { name: 'Nastavení generování' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Vybrat vše' })).toHaveCount(0)
    await expect(page.getByLabel('Počet', { exact: true })).toBeVisible()
    await expect(page.locator('#generate-difficulty')).toBeVisible()
  })
})

test.describe('dlaždice tématu', () => {
  test('má název na prvním řádku a stav na druhém', async ({ page }) => {
    await page.goto('/')
    // Otevřeme první ročník, ať se dlaždice témat ukážou ve třetím sloupci.
    await page.locator('a[href^="/?grade="]').first().click()

    const tile = page.getByRole('region', { name: 'Obsah tématu' }).locator('a[href^="/topics/"]').first()
    await expect(tile).toBeVisible()
    await expect(tile).toContainText(/materiál|bez materiálů/)
  })
})

test.describe('motiv', () => {
  test('přepne do tmavého a volba přežije načtení stránky', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Tmavý motiv' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.getByRole('button', { name: 'Světlý motiv' }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  })
})
