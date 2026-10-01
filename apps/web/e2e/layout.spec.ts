import { expect, test, type Page } from '@playwright/test'
import { testGradeQuery, testTopicPath } from './fixtures'

/**
 * Layout and overflow. Exactly these defects passed every code check, because
 * they only show when rendered.
 */

/** Pages the teacher uses all the time. */
const PAGES = [
  { path: '/', name: 'library' },
  { path: '/import', name: 'material import' },
  { path: '/tests', name: 'tests' },
  { path: '/tests/new', name: 'new test' },
  { path: '/templates', name: 'templates' },
]

const WIDTHS = [
  { width: 1440, height: 900, label: 'wide screen' },
  { width: 1200, height: 800, label: 'narrower laptop' },
  { width: 900, height: 800, label: 'narrow window' },
]

/** Horizontal overflow of the whole document. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

/**
 * Elements whose content overflows their own box. Measuring against the window
 * is not enough — text can stick out of a card inside a column without
 * breaking the whole page.
 */
async function overflowingElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const offenders: string[] = []
    for (const element of Array.from(document.querySelectorAll('body *'))) {
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) continue

      // The content is wider than the element and spills out. Truncated text
      // (`overflow: hidden`, ellipsis) and scrollable areas are fine — only `visible` overflows.
      const style = getComputedStyle(element)
      if (style.overflowX !== 'visible') continue
      if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
        const tag = element.tagName.toLowerCase()
        const cls = (element.getAttribute('class') ?? '').slice(0, 70)
        const text = (element.textContent ?? '').trim().slice(0, 40)
        offenders.push(
          `${tag}.${cls} — content ${element.scrollWidth} px in a ${element.clientWidth} px box — "${text}"`,
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
      test(`${target.name} fits the window`, async ({ page }) => {
        await page.goto(target.path)
        await page.waitForLoadState('networkidle')

        const overflow = await horizontalOverflow(page)
        expect(overflow, `${target.name} overflows the whole window horizontally`).toBeLessThanOrEqual(0)

        const offenders = await overflowingElements(page)
        if (offenders.length > 0) console.log(`${target.name} @ ${size.width}:\n${offenders.join('\n')}`)
        expect(offenders, `${target.name}: content overflows its box`).toEqual([])
      })
    }
  })
}

test.describe('library columns', () => {
  // Three columns (subjects and grades · grade topics · content) are now on the
  // home page, the class page and the topic page — not only on the topic as
  // before. The home page test uses `?vse=1` so a remembered class does not
  // pre-empt it with a redirect.
  test('above 1280 px there are three columns', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    await page.goto('/?vse=1')
    await expect(page.getByRole('link', { name: '6. ročník' }).first()).toBeVisible()

    await page.goto(await testGradeQuery(page.request))
    await expect(page.getByRole('link', { name: '6. ročník' }).first()).toBeVisible()

    await page.goto(await testTopicPath(page.request))
    await expect(page.getByRole('link', { name: '6. ročník' }).first()).toBeVisible()
  })

  test('below 1024 px tabs switch the panes and navigation stays reachable', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 })

    for (const goto of [
      () => page.goto('/?vse=1'),
      async () => page.goto(await testGradeQuery(page.request)),
      async () => page.goto(await testTopicPath(page.request)),
    ]) {
      await goto()
      const tab = page.getByRole('tab', { name: 'Předměty a ročníky' })
      await expect(tab).toBeVisible()
      await tab.click()
      await expect(page.getByRole('link', { name: '6. ročník' }).first()).toBeVisible()
    }
  })
})

test.describe('scrolling', () => {
  test('a long topic list can be scrolled to the end', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 700 })
    // The class with the most topics (over forty) — the content is reliably longer than the window.
    await page.goto('/')
    await page.getByRole('link', { name: /PŘÍRODOPIS · 6\. ročník/ }).first().click()
    await page.waitForLoadState('networkidle')

    // Find the area that scrolls and check it can move down.
    const scrolled = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('main, main *')) as HTMLElement[]
      const area = candidates.find((el) => el.scrollHeight > el.clientHeight + 20)
      if (!area) return { found: false, moved: 0 }
      area.scrollTop = 200
      return { found: true, moved: area.scrollTop }
    })

    expect(scrolled.found, 'content scrolls nowhere even though it is longer than the window').toBe(true)
    expect(scrolled.moved, 'the area cannot be scrolled').toBeGreaterThan(0)
  })
})

test.describe('topic tiles', () => {
  test('long names without spaces fit in the tile', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    // The seed has a long space-free name only in "6. ročník" of PŘÍRODOPIS.
    await page.goto('/')
    await page.getByRole('link', { name: /PŘÍRODOPIS · 6\. ročník/ }).first().click()
    // Navigation is client-side: the network goes idle before the page swaps
    // (reliably in WebKit), so wait for the class URL.
    await page.waitForURL(/\/tridy\//)
    await page.waitForLoadState('networkidle')

    // The library has names like `prirodopis-6_pl-bezobratli-vztahy._test_2018`.
    const offenders = await page.evaluate(() => {
      const bad: string[] = []
      const grid = Array.from(document.querySelectorAll('ul.grid')).find(
        (candidate) => candidate.getBoundingClientRect().width > 300,
      )
      if (!grid) return ['tile grid not found']

      // The tile is the whole card, not just the link inside it: the name with
      // the rename pencil is not a link, but must not stick out of the card either.
      for (const tile of Array.from(grid.querySelectorAll('[data-slot="card"]'))) {
        const limit = tile.getBoundingClientRect().right
        for (const child of Array.from(tile.querySelectorAll('*'))) {
          // Truncated text may have an ellipsis; only text sticking out of the tile is a bug.
          if (getComputedStyle(child).overflowX !== 'visible') continue
          if (child.getBoundingClientRect().right > limit + 1) {
            bad.push(`${(child.textContent ?? '').slice(0, 45)} sticks out of the tile`)
          }
        }
      }
      return bad.slice(0, 5)
    })

    expect(offenders, 'topic name overflows the tile').toEqual([])
  })
})

/**
 * Phone. The bank and the test list used to be tables with horizontal
 * scrolling and no hint that they scroll — at 390 px the status and the whole
 * action menu stayed past the screen edge and nothing could be done with a
 * test. So they are cards instead of a table: one card = one row, actions inside.
 */
test.describe('phone (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const target of [{ path: '/tests', name: 'tests', actions: /^Akce u testu/ }]) {
    test(`${target.name}: every item can open its action menu`, async ({ page }) => {
      if (target.path === '/tests') await ensureTest(page)
      await page.goto(target.path)
      await page.waitForLoadState('networkidle')

      // No table, hence no horizontal scrolling to get lost in.
      await expect(page.locator('main table')).toHaveCount(0)
      expect(await horizontalOverflow(page), `${target.name} overflows horizontally`).toBeLessThanOrEqual(0)

      const actions = page.getByRole('button', { name: target.actions })
      const count = await actions.count()
      expect(count, `${target.name}: items have no action menu on a phone`).toBeGreaterThan(0)

      // The button must be fully inside the window, otherwise it cannot be tapped.
      const box = await actions.first().boundingBox()
      expect(box, 'action menu is not visible').not.toBeNull()
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390)

      // The menu includes deleting the item — so on a phone everything can be
      // done with an item, not just reading it.
      await actions.first().click()
      await expect(page.getByRole('menuitem', { name: 'Smazat' })).toBeVisible()
    })
  }
})

/**
 * At least one test in the list. The e2e database is not seeded with tests —
 * individual specs create them, and the test list spec runs after this one.
 */
async function ensureTest(page: Page): Promise<void> {
  const list = await page.request.get('/api/tests')
  if (list.ok()) {
    const { tests: existing } = (await list.json()) as { tests?: unknown[] }
    if (existing && existing.length > 0) return
  }
  const bank = await page.request.get('/api/questions?status=approved&limit=1')
  expect(bank.ok()).toBe(true)
  const { items } = (await bank.json()) as { items: { id: string }[] }
  expect(items.length, 'the library has no approved questions').toBeGreaterThan(0)

  const created = await page.request.post('/api/tests', {
    data: {
      title: `E2E rozvržení ${Date.now()}`,
      description: null,
      graded: true,
      templateId: 'builtin-klasicka',
      header: { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
      variants: 1,
      showKey: true,
      items: [{ kind: 'question', questionId: items[0]!.id }],
    },
  })
  expect(created.ok(), 'could not create the sample test').toBe(true)
}
