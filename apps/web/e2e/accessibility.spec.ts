import { expect, test } from '@playwright/test'

/**
 * Two defects from the review: a missing outline under keyboard navigation
 * (fixed globally by the `:focus-visible` rule in packages/ui/src/styles.css)
 * and an unreachable top bar on a narrow screen (fixed by wrapping in
 * packages/ui/src/AppShell.tsx).
 */

/**
 * The key that actually moves focus between links and buttons in a given
 * engine. WebKit (like real Safari) with the default macOS settings tabs only
 * between text fields with a plain Tab — links and buttons need Option (Alt)
 * held down, exactly as in real Safari.
 */
function tabKey(browserName: string): string {
  return browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
}

/** Tabs until the active element matches the given text, or attempts run out. */
async function tabUntilText(
  page: import('@playwright/test').Page,
  browserName: string,
  text: string,
  limit = 20,
) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press(tabKey(browserName))
    const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')
    if (focused === text) return true
  }
  return false
}

/** Tabs until the active element has the given `aria-label`, or attempts run out. */
async function tabUntilLabel(
  page: import('@playwright/test').Page,
  browserName: string,
  label: string,
  limit = 20,
) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press(tabKey(browserName))
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')
    if (focused === label) return true
  }
  return false
}

async function activeOutline(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement
    const cs = getComputedStyle(el)
    return { style: cs.outlineStyle, width: cs.outlineWidth }
  })
}

test.describe('outline when tabbing', () => {
  test('a top bar link has no outline at rest but has one when focused', async ({ page, browserName }) => {
    // Playwright's WebKit on Windows skips links when tabbing, with or without
    // Option; it only reaches buttons and fields.
    test.skip(browserName === 'webkit' && process.platform === 'win32', 'WebKit on Windows does not tab to links.')
    await page.goto('/')

    const restOutline = await page.evaluate(() => {
      const link = document.querySelector('a[href="/tests"]') as HTMLElement
      return getComputedStyle(link).outlineStyle
    })
    expect(restOutline).toBe('none')

    const found = await tabUntilText(page, browserName, 'Testy')
    expect(found, 'tabbing never reached the "Testy" link').toBe(true)

    const focusOutline = await activeOutline(page)
    expect(focusOutline.style).not.toBe('none')
    expect(parseFloat(focusOutline.width)).toBeGreaterThan(0)
  })

  test('the theme switch (a button, not a link) has an outline when focused', async ({ page, browserName }) => {
    await page.goto('/')

    const restOutline = await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="Světlý motiv"]') as HTMLElement
      return getComputedStyle(button).outlineStyle
    })
    expect(restOutline).toBe('none')

    const found = await tabUntilLabel(page, browserName, 'Světlý motiv')
    expect(found, 'tabbing never reached the theme switch').toBe(true)

    const focusOutline = await activeOutline(page)
    expect(focusOutline.style).not.toBe('none')
    expect(parseFloat(focusOutline.width)).toBeGreaterThan(0)
  })

  test('the outline is visible in dark mode too', async ({ page, browserName }) => {
    // Playwright's WebKit on Windows skips links when tabbing, with or without
    // Option; it only reaches buttons and fields.
    test.skip(browserName === 'webkit' && process.platform === 'win32', 'WebKit on Windows does not tab to links.')
    await page.goto('/')
    await page.getByRole('button', { name: 'Tmavý motiv' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    // The theme choice is remembered in localStorage — after a reload tabbing
    // starts again from the document start, not from the last clicked button.
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)

    const found = await tabUntilText(page, browserName, 'Testy')
    expect(found, 'tabbing never reached the "Testy" link in dark mode').toBe(true)

    const focusOutline = await activeOutline(page)
    expect(focusOutline.style).not.toBe('none')
    expect(parseFloat(focusOutline.width)).toBeGreaterThan(0)
  })
})

test.describe('top bar on a phone (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('all navigation items and the theme switch are visible and reachable', async ({ page }) => {
    await page.goto('/')

    const header = page.locator('header')
    for (const label of ['Třídy', 'Testy', 'Hlavolamy', 'Šablony']) {
      await expect(header.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    for (const label of ['Světlý motiv', 'Tmavý motiv', 'Podle systému']) {
      await expect(header.getByRole('button', { name: label })).toBeVisible()
    }

    // The bar may be taller (wrapped onto several lines) but must not overflow horizontally.
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('header')!
      return el.scrollWidth - el.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(0)

    // The last navigation item and the theme switch must lie inside the window.
    const viewport = page.viewportSize()!
    const templatesBox = await header.getByRole('link', { name: 'Šablony' }).boundingBox()
    const themeBox = await header.getByRole('button', { name: 'Tmavý motiv' }).boundingBox()
    expect(templatesBox?.x).toBeGreaterThanOrEqual(0)
    expect((templatesBox?.x ?? 0) + (templatesBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width)
    expect(themeBox?.x).toBeGreaterThanOrEqual(0)
    expect((themeBox?.x ?? 0) + (themeBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width)
  })
})
