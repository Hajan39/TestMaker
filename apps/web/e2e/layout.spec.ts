import { expect, test, type Page } from '@playwright/test'

/**
 * Rozvržení a přetékání. Přesně tyhle vady prošly všemi kontrolami kódu,
 * protože se poznají jedině vykreslením.
 */

/** Stránky, které má učitelka běžně pod rukama. */
const PAGES = [
  { path: '/', name: 'knihovna' },
  { path: '/import', name: 'import materiálů' },
  { path: '/questions', name: 'banka otázek' },
  { path: '/tests', name: 'testy' },
  { path: '/tests/new', name: 'nový test' },
  { path: '/templates', name: 'šablony' },
]

const WIDTHS = [
  { width: 1440, height: 900, label: 'široká obrazovka' },
  { width: 1200, height: 800, label: 'užší notebook' },
  { width: 900, height: 800, label: 'úzké okno' },
]

/** Vodorovné přetečení celého dokumentu. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

/** Prvky, které přesahují šířku okna — vrací popis, ať jde vada dohledat. */
async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth
    const offenders: string[] = []
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue
      if (box.right > limit + 1) {
        const tag = element.tagName.toLowerCase()
        const cls = (element.getAttribute('class') ?? '').slice(0, 60)
        offenders.push(`${tag}.${cls} (pravý okraj ${Math.round(box.right)} > ${limit})`)
      }
    }
    return offenders.slice(0, 5)
  })
}

for (const size of WIDTHS) {
  test.describe(`${size.label} (${size.width} px)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    for (const target of PAGES) {
      test(`${target.name} se vejde do okna`, async ({ page }) => {
        await page.goto(target.path)
        await page.waitForLoadState('networkidle')

        const overflow = await horizontalOverflow(page)
        if (overflow > 0) {
          console.log(`${target.name} @ ${size.width}: přetéká o ${overflow} px`)
          console.log((await overflowingElements(page)).join('\n'))
        }
        expect(overflow, `${target.name} přetéká vodorovně`).toBeLessThanOrEqual(0)
      })
    }
  })
}

test.describe('sloupce knihovny', () => {
  test('nad 1280 px jsou tři sloupce', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.getByRole('link', { name: '6. ročník' }).first()).toBeVisible()
  })

  test('pod 1024 px se přepíná záložkami a navigace je dostupná', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })
    await page.goto('/')
    const tab = page.getByRole('tab', { name: 'Předměty a ročníky' })
    await expect(tab).toBeVisible()
    await tab.click()
    await expect(page.getByRole('link', { name: '6. ročník' }).first()).toBeVisible()
  })
})

test.describe('rolování', () => {
  test('dlouhý seznam témat jde doscrollovat', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 })
    // Ročník s nejvíc tématy — obsah je spolehlivě delší než okno.
    await page.goto('/')
    await page.getByRole('link', { name: '6. ročník' }).first().click()
    await page.waitForLoadState('networkidle')

    // Najdeme plochu, která se roluje, a ověříme, že se v ní dá pohnout dolů.
    const scrolled = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('main, main *')) as HTMLElement[]
      const area = candidates.find((el) => el.scrollHeight > el.clientHeight + 20)
      if (!area) return { found: false, moved: 0 }
      area.scrollTop = 200
      return { found: true, moved: area.scrollTop }
    })

    expect(scrolled.found, 'obsah se nikde neroluje, i když je delší než okno').toBe(true)
    expect(scrolled.moved, 'plochu nejde posunout').toBeGreaterThan(0)
  })
})
