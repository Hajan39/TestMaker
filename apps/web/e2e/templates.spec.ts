import { expect, test } from '@playwright/test'

/**
 * Náhledy šablon. V Safari se u vloženého PDF nespustí událost o načtení,
 * takže zástupná plocha zůstávala navrchu a překrývala hotový náhled.
 */
test.describe('náhledy šablon', () => {
  test('zástupná plocha zmizí a náhled zůstane vidět', async ({ page }) => {
    await page.goto('/templates')

    const frames = page.locator('iframe[title="Náhled šablony"]')
    await expect(frames.first()).toBeVisible()
    expect(await frames.count()).toBeGreaterThanOrEqual(3)

    // Plocha se musí uklidit i tam, kde prohlížeč načtení neohlásí.
    await expect(page.locator('div[aria-hidden="true"].absolute.inset-0')).toHaveCount(0, {
      timeout: 6000,
    })

    // A nesmí se vrátit — dřív to působilo jako blikání dokola.
    await page.waitForTimeout(1500)
    await expect(page.locator('div[aria-hidden="true"].absolute.inset-0')).toHaveCount(0)
  })

  test('náhled se skutečně načte z API', async ({ page }) => {
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
