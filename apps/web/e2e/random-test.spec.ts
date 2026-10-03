import { expect, test } from '@playwright/test'

/**
 * Building a test by random draw. The teacher ticks the topics, says how much
 * there should be and the app composes the test; it is only inserted into the
 * outline so anything can be reordered or deleted, and only then saved.
 */
test.describe('randomly composed test', () => {
  test('fills the outline and can be saved', async ({ page }) => {
    await page.goto('/tests/new')
    await page.getByRole('button', { name: 'Sestavit náhodně' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // The dialog must fit on screen: the topic list tends to be long and scrolls
    // inside, instead of the window growing over the whole page.
    const viewport = page.viewportSize()
    const box = await dialog.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeLessThanOrEqual((viewport?.height ?? 720) + 1)

    // Select the whole library and draw five questions.
    await dialog.getByRole('button', { name: 'Vybrat vše' }).click()
    await dialog.getByLabel('Otázek', { exact: true }).fill('5')

    const summary = dialog.getByTestId('random-summary')
    await expect(summary).toContainText('5 otázek')

    // Another draw gives another selection. The whole list is compared, not just
    // the first item: that one may well repeat on a new draw, so the test would
    // fail now and then with nothing to fix.
    const drawn = async () => (await dialog.locator('ol li').allInnerTexts()).join('|')
    const before = await drawn()
    await dialog.getByRole('button', { name: 'Zamíchat znovu' }).click()
    await expect
      .poll(async () => (await drawn()) !== before, { timeout: 15000, message: 'the draw did not change' })
      .toBe(true)

    await dialog.getByRole('button', { name: 'Vložit do osnovy' }).click()
    await expect(dialog).toBeHidden()

    // The outline has five questions and the test can be saved; counts are in the page footer.
    await expect(page.getByTestId('test-question-count')).toHaveAttribute('data-count', '5')
    await page.getByLabel('Název písemky').fill('Náhodná písemka')
    await page.getByRole('button', { name: 'Uložit' }).click()
    await page.waitForURL((url) => /\/tests\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith('/new'))

    await page.goto(page.url())
    await expect(page.getByTestId('test-question-count')).toHaveAttribute('data-count', '5')
  })
})
