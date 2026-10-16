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
    await expect(page.getByTestId('test-question-count')).toBeVisible()
    await expect(page.getByTestId('test-question-count')).not.toHaveAttribute('data-count', '0')
  })

  test('generating in a topic offers question types: at least one, sent to the server, remembered', async ({ page }) => {
    // The owner reversed the earlier "all types always" decision: the teacher
    // picks the types. The "Doplnit na celkový počet" mode stays bulk-only.
    await page.goto(await testTopicPath(page.request))
    const generate = page.getByRole('button', { name: 'Vygenerovat otázky' })
    await expect(generate).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Nastavení generování' })).toHaveCount(0)

    const types = page.getByRole('group', { name: 'Typy otázek' })
    const boxes = types.getByRole('checkbox')
    // All types by default, so "Vybrat vše" has nothing to do.
    await expect(boxes).toHaveCount(8)
    for (const box of await boxes.all()) await expect(box).toBeChecked()
    await expect(types.getByRole('button', { name: 'Vybrat vše' })).toBeDisabled()

    // Nothing ticked: explained right there and generation cannot start.
    for (const box of await boxes.all()) await box.click()
    await expect(page.getByTestId('generate-types-error')).toBeVisible()
    await expect(generate).toBeDisabled()

    await types.getByRole('checkbox', { name: 'Krátká odpověď' }).click()
    await types.getByRole('checkbox', { name: 'Přiřazování dvojic' }).click()
    await expect(page.getByTestId('generate-types-error')).toHaveCount(0)
    await expect(generate).toBeEnabled()

    // The choice survives a reload.
    await page.reload()
    await expect(types.getByRole('checkbox', { name: 'Krátká odpověď' })).toBeChecked()
    await expect(types.getByRole('checkbox', { name: 'Přiřazování dvojic' })).toBeChecked()
    await expect(types.getByRole('checkbox', { name: 'Volná odpověď' })).not.toBeChecked()

    // Only the chosen types go to the server. The model is never called: the
    // request is answered with a finished run in which most questions were
    // dropped as repeats, and the summary then says the materials ran out.
    let sentTypes: unknown = null
    await page.route('**/api/generate', async (route) => {
      sentTypes = (route.request().postDataJSON() as { types: unknown }).types
      const done = {
        type: 'done',
        created: 2,
        requested: 10,
        rejected: 0,
        similar: 8,
        failedCalls: 0,
        topicId: 'zkouska',
        sources: 1,
        models: ['zkouska'],
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: `${JSON.stringify({ type: 'start' })}\n${JSON.stringify(done)}\n`,
      })
    })
    await generate.click()
    const outcome = page.getByTestId('generation-outcome')
    await expect(outcome).toHaveAttribute('data-similar', '8')
    await expect(outcome).toHaveAttribute('data-exhausted', 'true')
    expect(sentTypes).toEqual(['short_answer', 'matching'])
  })

  test('a topic with many questions for its materials warns that new ones will repeat', async ({ page }) => {
    // The fixture topic has about one and a half thousand characters of text
    // and at least three questions — ten more is beyond what it can hold.
    // (A fresh topic without questions has no warning: generation.spec.ts.)
    await page.goto(await testTopicPath(page.request))
    await expect(page.getByTestId('generate-hint')).toHaveAttribute('data-count', '10')
    await expect(page.getByTestId('exhausted-topic-warning')).toBeVisible()
  })
})

test.describe('topic tile', () => {
  test('has the name on the first line and the status on the second', async ({ page }) => {
    await page.goto('/')
    // Open the first class so its topic tiles show.
    await page.locator('a[href^="/tridy/"]').first().click()

    await expect(page.locator('main a[href^="/topics/"]').first()).toBeVisible()
    await expect(page.getByTestId('topic-tile-status').first()).toHaveAttribute('data-materials', /^\d+$/)
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
