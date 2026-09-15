import { expect, test } from '@playwright/test'

/**
 * Dvě vady z revize: chybějící obrys při ovládání klávesnicí (opraveno
 * systémově pravidlem `:focus-visible` v packages/ui/src/styles.css) a
 * nedosažitelná horní lišta na úzké obrazovce (opraveno zalomením v
 * packages/ui/src/AppShell.tsx).
 */

/**
 * Klávesa, kterou se v daném enginu skutečně přesouvá zaostření mezi odkazy
 * a tlačítky. WebKit (jako skutečný Safari) prostým Tabem podle výchozího
 * nastavení macOS tabuluje jen mezi textovými poli — na odkazy a tlačítka se
 * dostane teprve s Option (Alt) přidrženým, přesně jako v reálném Safari.
 */
function tabKey(browserName: string): string {
  return browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
}

/** Tabuluje, dokud aktivní prvek neodpovídá hledanému textu, nebo dokud nedojdou pokusy. */
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

/** Tabuluje, dokud aktivní prvek nemá daný `aria-label`, nebo dokud nedojdou pokusy. */
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

test.describe('obrys při procházení tabulátorem', () => {
  test('odkaz v horní liště nemá obrys v klidu, ale má ho po zaostření', async ({ page, browserName }) => {
    await page.goto('/')

    const restOutline = await page.evaluate(() => {
      const link = document.querySelector('a[href="/import"]') as HTMLElement
      return getComputedStyle(link).outlineStyle
    })
    expect(restOutline).toBe('none')

    const found = await tabUntilText(page, browserName, 'Import materiálů')
    expect(found, 'tabulátor se na odkaz „Import materiálů“ nedostal').toBe(true)

    const focusOutline = await activeOutline(page)
    expect(focusOutline.style).not.toBe('none')
    expect(parseFloat(focusOutline.width)).toBeGreaterThan(0)
  })

  test('přepínač motivu (tlačítko, ne odkaz) má obrys po zaostření', async ({ page, browserName }) => {
    await page.goto('/')

    const restOutline = await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="Světlý motiv"]') as HTMLElement
      return getComputedStyle(button).outlineStyle
    })
    expect(restOutline).toBe('none')

    const found = await tabUntilLabel(page, browserName, 'Světlý motiv')
    expect(found, 'tabulátor se na přepínač motivu nedostal').toBe(true)

    const focusOutline = await activeOutline(page)
    expect(focusOutline.style).not.toBe('none')
    expect(parseFloat(focusOutline.width)).toBeGreaterThan(0)
  })

  test('obrys je vidět i v tmavém režimu', async ({ page, browserName }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Tmavý motiv' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    // Volba motivu se pamatuje v localStorage — po znovunačtení začíná
    // tabulátor znovu od začátku dokumentu, ne od naposledy klikutého tlačítka.
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)

    const found = await tabUntilText(page, browserName, 'Import materiálů')
    expect(found, 'tabulátor se na odkaz „Import materiálů“ v tmavém režimu nedostal').toBe(true)

    const focusOutline = await activeOutline(page)
    expect(focusOutline.style).not.toBe('none')
    expect(parseFloat(focusOutline.width)).toBeGreaterThan(0)
  })
})

test.describe('horní lišta na telefonu (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('všechny položky navigace a přepínač motivu jsou vidět a dosažitelné', async ({ page }) => {
    await page.goto('/')

    const header = page.locator('header')
    for (const label of ['Knihovna', 'Import materiálů', 'Banka otázek', 'Testy', 'Šablony']) {
      await expect(header.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    for (const label of ['Světlý motiv', 'Tmavý motiv', 'Podle systému']) {
      await expect(header.getByRole('button', { name: label })).toBeVisible()
    }

    // Lišta smí být vyšší (zalomená na víc řádků), ale nesmí přetékat vodorovně.
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('header')!
      return el.scrollWidth - el.clientWidth
    })
    expect(overflow).toBeLessThanOrEqual(0)

    // Poslední položka navigace i přepínač motivu musí ležet uvnitř okna.
    const viewport = page.viewportSize()!
    const templatesBox = await header.getByRole('link', { name: 'Šablony' }).boundingBox()
    const themeBox = await header.getByRole('button', { name: 'Tmavý motiv' }).boundingBox()
    expect(templatesBox?.x).toBeGreaterThanOrEqual(0)
    expect((templatesBox?.x ?? 0) + (templatesBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width)
    expect(themeBox?.x).toBeGreaterThanOrEqual(0)
    expect((themeBox?.x ?? 0) + (themeBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width)
  })
})
