/**
 * Regression: the bold font lost letters („Řešení" → „ešení", „Seřaď" → „eřaď")
 * and a control character appeared instead of "e" in the PDF text layer.
 *
 * The cause was in fontkit: it caches glyphs by number and stores the code
 * points (which letters the glyph stands for) only when first created. The
 * font subset at the end of a document also creates components of composite
 * glyphs („ě" = "e" + caron) without code points. The font is not reloaded
 * between renders, so in the next document "e" got a glyph with empty code
 * points and react-pdf then scrambled the glyph-to-character mapping — the
 * first letter of the line dropped out. The fix is in
 * `patches/fontkit@2.0.4.patch`.
 *
 * Hence two renders in the same process: the first document has „ě" and „é"
 * in bold but no standalone "e"; only the second contains the searched text.
 */
import { describe, expect, it } from 'vitest'
import { renderTestToBuffer } from '../src/pdf/node'
import { extractPdf } from '../src/extract/pdf'
import type { ResolvedTestItem } from '../src/schema/test'
import { makeItems, makeTemplate, makeTest } from './fixtures'

const heading = (text: string): ResolvedTestItem =>
  ({ id: 'h-reseni', testId: 'test-1', order: 99, kind: 'heading', questionId: null, text, pointsOverride: null }) as ResolvedTestItem

describe('PDF — bold font after a previous render', () => {
  it('does not lose „Ř" or „S" at the start of bold text', async () => {
    // The first render only "poisons" the bold face glyph cache.
    await renderTestToBuffer({
      test: makeTest({ title: 'Osmisměrka – fotosyntéza' }),
      template: makeTemplate('klasicka'),
      items: [],
      variant: 'A',
      withKey: false,
      assets: {},
    })

    for (const slug of ['klasicka', 'kompaktni', 'pracovni-list']) {
      const buffer = await renderTestToBuffer({
        test: makeTest(),
        template: makeTemplate(slug),
        items: [...makeItems(), heading('Řešení')],
        variant: 'A',
        withKey: false,
        assets: {},
      })
      const { text } = await extractPdf(new Uint8Array(buffer))
      // The compact template prints headings in capitals.
      expect(text.toLocaleLowerCase('cs'), slug).toContain('řešení')
      expect(text, slug).toContain('Seřaď')
      // Control characters in the text layer mean a glyph without an assigned letter.
      expect(text, slug).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/)
    }
  })

  it('prints the footer with the page number within the test', async () => {
    const buffer = await renderTestToBuffer({
      test: makeTest(),
      template: makeTemplate('klasicka'),
      items: makeItems(),
      variant: 'A',
      withKey: true,
      assets: {},
    })
    const { text } = await extractPdf(new Uint8Array(buffer))
    expect(text).toContain('varianta A')
    expect(text).toMatch(/strana 1 \/ \d/)
    // Key pages are not counted into the test's total page count.
    const total = Number(/strana 1 \/ (\d+)/.exec(text)?.[1])
    expect(text).toContain(`strana ${total} / ${total}`)
    expect(text).not.toContain(`strana ${total + 1} /`)
  })
})
