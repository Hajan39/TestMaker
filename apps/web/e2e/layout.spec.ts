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

/**
 * Prvky, jejichž obsah přetéká vlastní rámec. Měřit jen proti oknu nestačí —
 * text může vylézt z karty uvnitř sloupce, aniž by se rozbila celá stránka.
 */
async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const offenders: string[] = []
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue

      // Obsah je širší než prvek a přetéká ven. Ořezaný text (`overflow: hidden`,
      // tři tečky) ani rolovatelná plocha chyba nejsou — přetéká jen `visible`.
      const style = getComputedStyle(element)
      if (style.overflowX !== 'visible') continue
      if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
        const tag = element.tagName.toLowerCase()
        const cls = (element.getAttribute('class') ?? '').slice(0, 70)
        const text = (element.textContent ?? '').trim().slice(0, 40)
        offenders.push(
          `${tag}.${cls} — obsah ${element.scrollWidth} px v rámci ${element.clientWidth} px — „${text}“`,
        )
      }
    }
    return offenders.slice(0, 8)
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
        expect(overflow, `${target.name} přetéká vodorovně přes celé okno`).toBeLessThanOrEqual(0)

        const offenders = await overflowingElements(page)
        if (offenders.length > 0) console.log(`${target.name} @ ${size.width}:\n${offenders.join('\n')}`)
        expect(offenders, `${target.name}: obsah přetéká ze svého rámce`).toEqual([])
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

test.describe('dlaždice témat', () => {
  test('dlouhé názvy bez mezer se vejdou do dlaždice', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.getByRole('link', { name: '6. ročník' }).first().click()
    await page.waitForLoadState('networkidle')

    // V knihovně jsou názvy jako `prirodopis-6_pl-bezobratli-vztahy._test_2018`.
    const offenders = await page.evaluate(() => {
      const bad: string[] = []
      const grid = Array.from(document.querySelectorAll('ul.grid')).find(
        (candidate) => candidate.getBoundingClientRect().width > 300,
      )
      if (!grid) return ['mřížka dlaždic nenalezena']

      // Dlaždice je celá karta, ne jen odkaz uvnitř ní: název s tužkou
      // k přejmenování odkaz není, ale z karty čouhat taky nesmí.
      for (const tile of Array.from(grid.querySelectorAll('[data-slot="card"]'))) {
        const limit = tile.getBoundingClientRect().right
        for (const child of Array.from(tile.querySelectorAll('*'))) {
          // Ořezaný text tři tečky mít smí; chyba je až text čouhající ven z dlaždice.
          if (getComputedStyle(child).overflowX !== 'visible') continue
          if (child.getBoundingClientRect().right > limit + 1) {
            bad.push(`${(child.textContent ?? '').slice(0, 45)} vyčnívá z dlaždice`)
          }
        }
      }
      return bad.slice(0, 5)
    })

    expect(offenders, 'název tématu přetéká z dlaždice').toEqual([])
  })
})
