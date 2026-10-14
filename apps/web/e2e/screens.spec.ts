import { expect, test, type Page } from '@playwright/test'
import { testGradeQuery, testTopicPath } from './fixtures'

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

  const screens = [
    { path: () => '/', name: 'knihovna' },
    { path: (page: Page) => testGradeQuery(page.request), name: 'rocnik' },
    { path: (page: Page) => testTopicPath(page.request), name: 'tema' },
    { path: () => '/import', name: 'import' },
    { path: () => '/generovani', name: 'generovani' },
    { path: () => '/tests', name: 'testy' },
    { path: () => '/tests/new', name: 'skladani-testu' },
    { path: () => '/listy', name: 'listy' },
    { path: () => '/listy/new', name: 'novy-list' },
    { path: () => '/listy/e2e-pracovni-list', name: 'list' },
    { path: () => '/hlavolamy', name: 'hlavolamy' },
    { path: () => '/templates', name: 'sablony' },
    { path: () => '/sprava', name: 'sprava' },
    { path: () => '/zaloha', name: 'zaloha' },
  ]
  // Every screen on a desktop in both themes, plus a phone in the light theme.
  const variants = [
    { width: 1440, theme: 'light' as const },
    { width: 1440, theme: 'dark' as const },
    { width: 390, theme: 'light' as const },
  ]
  const shots = screens.flatMap((screen) => variants.map((variant) => ({ ...screen, ...variant })))

  for (const shot of shots) {
    const file = `${shot.name}-${shot.theme}-${shot.width}`
    test(`screenshot: ${file}`, async ({ page }) => {
      // The theme follows the system unless the teacher picked one, so emulating it is enough.
      await page.emulateMedia({ colorScheme: shot.theme })
      await page.setViewportSize({ width: shot.width, height: 900 })
      const response = await page.goto(await shot.path(page))
      expect(response?.ok(), `${file}: page did not load`).toBe(true)
      await page.waitForLoadState('networkidle')

      // The page must have content — otherwise the screenshot would be a nicely
      // named picture of nothing. (`nextjs-portal` is useless for this: the dev
      // overlay stays in the DOM even when everything is fine.)
      await expect(page.locator('main')).toBeVisible()
      const text = (await page.locator('main').innerText()).trim()
      expect(text.length, `${file}: screen is empty`).toBeGreaterThan(20)

      await page.screenshot({ path: `e2e/screenshots/${file}.png`, fullPage: true })
    })
  }
})
