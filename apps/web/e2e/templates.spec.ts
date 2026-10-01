import { expect, test } from '@playwright/test'

/**
 * Template previews. Safari does not fire the load event for an embedded PDF,
 * so the placeholder stayed on top and covered the finished preview.
 */
test.describe('template previews', () => {
  test('the placeholder disappears and the preview stays visible', async ({ page }) => {
    await page.goto('/templates')

    const frames = page.locator('iframe[title="Náhled šablony"]')
    await expect(frames.first()).toBeVisible()
    expect(await frames.count()).toBeGreaterThanOrEqual(3)

    // The placeholder must go away even where the browser does not report the load.
    await expect(page.locator('div[aria-hidden="true"].absolute.inset-0')).toHaveCount(0, {
      timeout: 6000,
    })

    // And it must not come back — that used to look like endless flickering.
    await page.waitForTimeout(1500)
    await expect(page.locator('div[aria-hidden="true"].absolute.inset-0')).toHaveCount(0)
  })

  test('the preview is actually loaded from the API', async ({ page }) => {
    const responses: number[] = []
    page.on('response', (response) => {
      if (response.url().includes('/preview')) responses.push(response.status())
    })
    await page.goto('/templates')
    await page.waitForLoadState('networkidle')
    expect(responses.length).toBeGreaterThan(0)
    expect(responses.every((status) => status === 200)).toBe(true)
  })
})
