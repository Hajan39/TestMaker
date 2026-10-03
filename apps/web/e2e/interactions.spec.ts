import { expect, test } from '@playwright/test'
import { testTopicPath } from './fixtures'

/**
 * Behaviour that can only be verified by real interaction: dialogs, dropdown
 * menus, keyboard and printing. Exactly what nobody verified before.
 */

// Each test finds a workable topic itself via `testTopicPath` — an id hardcoded
// from the author's disk would not exist in another database.

test.describe('question editor', () => {
  // The question bank, where editing used to open as a dialog from the row menu
  // (Escape closes, focus returns to the trigger), was removed entirely — in a
  // topic the question is edited right in its card, without a dialog, so this
  // scenario has nowhere left to run.

  test('the question type menu is operable and changes the form fields', async ({ page }) => {
    await page.goto(await testTopicPath(page.request))
    await page.getByRole('button', { name: 'Nová otázka' }).click()

    const form = page.getByTestId('new-question-form')
    await form.getByLabel('Typ').click()
    await page.getByRole('option', { name: 'Volná odpověď' }).click()

    // A free answer asks for the number of lines; a choice question does not.
    await expect(form.getByLabel('Počet linek')).toBeVisible()
  })
})

test.describe('question filters', () => {
  test('the dropdown opens and selects a value', async ({ page }) => {
    await page.goto(await testTopicPath(page.request))

    const typeFilter = page.getByLabel('Typ')
    await typeFilter.click()
    await page.getByRole('option', { name: 'Pravda / nepravda' }).click()
    await expect(typeFilter).toContainText('Pravda / nepravda')
  })
})

test.describe('topic materials management', () => {
  test('offers moving to another grade', async ({ page }) => {
    await page.goto(await testTopicPath(page.request))
    await page.getByRole('button', { name: 'Upravit téma' }).click()

    // Exactly "Ročník" — the side panels have "ročníky" and "ročníku" in their names.
    const gradeSelect = page.getByLabel('Ročník', { exact: true })
    await expect(gradeSelect).toBeVisible()
    await gradeSelect.click()
    await expect(page.getByRole('option', { name: 'Bez ročníku' })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Jiný ročník…' })).toBeVisible()
  })
})

test.describe('generation menu', () => {
  test('depends on whether a model key is set', async ({ page, request }) => {
    // The developer may or may not have a key set — so the test first asks the
    // app for the state. Without a key the route answers 503, with a key it
    // stops only at invalid data (400).
    const probe = await request.post('/api/generate', { data: {}, failOnStatusCode: false })
    const configured = probe.status() !== 503

    // The label differs depending on whether the topic already has questions ("Dogenerovat").
    const topicButton = page.getByRole('button', { name: /generovat otázky$/i })
    const bulkButton = page.getByRole('button', { name: 'Hromadné generování' })

    await page.goto(await testTopicPath(page.request))
    if (configured) await expect(topicButton).toBeVisible()
    else {
      await expect(topicButton).toHaveCount(0)
    }

    // `?vse=1`: the test opened a topic before, so `/` would otherwise silently
    // redirect to its class instead of the tile home page.
    await page.goto('/?vse=1')
    if (configured) await expect(bulkButton).toBeVisible()
    else await expect(bulkButton).toHaveCount(0)
  })
})

test.describe('tisk testu', () => {
  test('the button embeds the PDF in the page and triggers printing', async ({ page }) => {
    // Prepare a test with one item via the API so there is something to print.
    const created = await page.request.post('/api/tests', {
      data: {
        title: 'Zkouška tisku',
        description: null,
        graded: true,
        templateId: 'builtin-klasicka',
        header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
        variants: 1,
        showKey: false,
        items: [{ kind: 'heading', questionId: null, text: 'Část A', pointsOverride: null }],
      },
    })
    expect(created.ok()).toBe(true)
    const { id } = (await created.json()) as { id: string }

    try {
      await page.goto('/tests')
      const pdf = page.waitForResponse((response) => response.url().includes(`/api/tests/${id}/pdf`))
      await page.getByRole('button', { name: 'Akce' }).first().click()
      await page.getByRole('menuitem', { name: 'Vytisknout zadání pro žáky' }).click()

      // The PDF is downloaded first (so a server error does not get printed as text)
      // and the result goes into the frame as a blob; that is the observable effect.
      expect((await pdf).ok()).toBe(true)
      await expect
        .poll(async () => page.locator('iframe[src^="blob:"]').count(), { timeout: 10_000 })
        .toBeGreaterThan(0)
    } finally {
      await page.request.delete(`/api/tests?id=${encodeURIComponent(id)}`)
    }
  })
})
