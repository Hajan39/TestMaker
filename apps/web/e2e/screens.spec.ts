import { expect, test, type Page } from '@playwright/test'
import { testGradeQuery } from './fixtures'

/**
 * Takes screenshots of the main screens into `e2e/screenshots` so the look,
 * which neither the code nor the HTML reveals, can be judged. Not part of a normal run.
 *
 * A screenshot asserts nothing by itself, so each screen is also checked to
 * have actually rendered: an empty or broken page would otherwise end up as a
 * nicely named picture of nothing.
 */
test.describe('screenshots', () => {
  test.skip(!process.env.SCREENSHOTS, 'runs only with the SCREENSHOTS variable')

  const shots = [
    { path: () => '/', name: 'knihovna', width: 1440 },
    { path: (page: Page) => testGradeQuery(page.request), name: 'rocnik', width: 1440 },
    { path: () => '/import', name: 'import', width: 1440 },
    { path: () => '/tests', name: 'testy', width: 1440 },
    { path: () => '/templates', name: 'sablony', width: 1440 },
    { path: () => '/tests/new', name: 'skladani-testu', width: 1440 },
    { path: () => '/', name: 'knihovna-1200', width: 1200 },
    { path: () => '/', name: 'knihovna-900', width: 900 },
  ]

  for (const shot of shots) {
    test(`screenshot: ${shot.name}`, async ({ page }) => {
      await page.setViewportSize({ width: shot.width, height: 900 })
      const response = await page.goto(await shot.path(page))
      expect(response?.ok(), `${shot.name}: page did not load`).toBe(true)
      await page.waitForLoadState('networkidle')

      // The page must have content — otherwise the screenshot would be a nicely
      // named picture of nothing. (`nextjs-portal` is useless for this: the dev
      // overlay stays in the DOM even when everything is fine.)
      await expect(page.locator('main')).toBeVisible()
      const text = (await page.locator('main').innerText()).trim()
      expect(text.length, `${shot.name}: screen is empty`).toBeGreaterThan(20)

      await page.screenshot({ path: `e2e/screenshots/${shot.name}.png`, fullPage: false })
    })
  }
})
