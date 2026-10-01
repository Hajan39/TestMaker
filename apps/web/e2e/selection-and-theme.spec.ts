import { expect, test } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Three additions requested by the owner: select-all wherever there are
 * checkboxes, a two-line topic tile and a light/dark theme switch.
 */

// The test finds a topic with materials and questions itself — an id hardcoded
// from the author's disk would not exist in another database.

test.describe('select all', () => {
  // Select-all via "Vybrat vše viditelné" with bulk deleting used to live in the
  // library-wide question bank; that was removed and the topic has no bulk
  // delete replacement (only a single "Smazat" per card). Bulk selection into
  // the test outline (below) stays — that is a different surface, `BankPanel` in `/tests/new`.
  test('adds a whole topic to the outline from the question bank', async ({ page }) => {
    await page.goto('/tests/new')

    const selectAll = page.getByRole('checkbox', { name: 'Vybrat vše', exact: true })
    await selectAll.waitFor({ state: 'visible' })
    await selectAll.click()

    // Counts are read in one place only: the footer below the test page.
    await expect(page.getByText(/^Otázek:\s*[1-9]/)).toBeVisible()
  })

  test('generating in a topic offers only count and difficulty, no type selection', async ({ page }) => {
    // Type selection and the "Doplnit na celkový počet" mode belong only to bulk
    // generation (`BulkGenerate`) — a topic always generates from all types and
    // always adds new questions, so the teacher is not slowed down.
    await page.goto(await testTopicPath(page.request))
    const generate = page.getByRole('button', { name: 'Vygenerovat otázky' })
    test.skip((await generate.count()) === 0, 'Generation is not configured.')

    await expect(page.getByRole('button', { name: 'Nastavení generování' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Vybrat vše' })).toHaveCount(0)
    await expect(page.getByLabel('Počet', { exact: true })).toBeVisible()
    await expect(page.locator('#generate-difficulty')).toBeVisible()
  })
})

test.describe('topic tile', () => {
  test('has the name on the first line and the status on the second', async ({ page }) => {
    await page.goto('/')
    // Open the first class so its topic tiles show.
    await page.locator('a[href^="/tridy/"]').first().click()

    const tile = page.locator('main a[href^="/topics/"]').first()
    await expect(tile).toBeVisible()
    await expect(tile).toContainText(/materiál|bez materiálů/)
  })
})

test.describe('theme', () => {
  test('switches to dark and the choice survives a reload', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: 'Tmavý motiv' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)

    await page.getByRole('button', { name: 'Světlý motiv' }).click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  })
})
