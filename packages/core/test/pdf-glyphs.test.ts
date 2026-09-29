/**
 * Regrese: tučné písmo ztrácelo písmena („Řešení" → „ešení", „Seřaď" → „eřaď")
 * a v textové vrstvě PDF se místo „e" objevoval řídicí znak.
 *
 * Příčina byla ve fontkitu: glyfy si pamatuje podle čísla a kódové body
 * (která písmena glyf znamená) ukládá jen při prvním vytvoření. Subset fontu
 * na konci dokumentu vytváří i součásti složených glyfů („ě" = „e" + háček)
 * bez kódových bodů. Font se mezi rendery nenačítá znovu, takže v dalším
 * dokumentu dostalo „e" glyf s prázdnými kódovými body a react-pdf pak
 * rozhodil přiřazení glyfů ke znakům — první písmeno řádku vypadlo.
 * Oprava je v `patches/fontkit@2.0.4.patch`.
 *
 * Proto se tu renderuje dvakrát ve stejném procesu: první dokument má v tučném
 * „ě" a „é", ale žádné samostatné „e"; teprve druhý obsahuje hledaný text.
 */
import { describe, expect, it } from 'vitest'
import { renderTestToBuffer } from '../src/pdf/node'
import { extractPdf } from '../src/extract/pdf'
import type { ResolvedTestItem } from '../src/schema/test'
import { makeItems, makeTemplate, makeTest } from './fixtures'

const heading = (text: string): ResolvedTestItem =>
  ({ id: 'h-reseni', testId: 'test-1', order: 99, kind: 'heading', questionId: null, text, pointsOverride: null }) as ResolvedTestItem

describe('PDF — tučné písmo po předchozím renderu', () => {
  it('neztratí „Ř" ani „S" na začátku tučného textu', async () => {
    // První render jen „otráví" mezipaměť glyfů tučného řezu.
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
      // Kompaktní šablona píše nadpisy verzálkami.
      expect(text.toLocaleLowerCase('cs'), slug).toContain('řešení')
      expect(text, slug).toContain('Seřaď')
      // Řídicí znaky v textové vrstvě znamenají glyf bez přiřazeného písmene.
      expect(text, slug).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/)
    }
  })

  it('vytiskne zápatí s číslem strany v rámci písemky', async () => {
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
    // Stránky klíče se do celkového počtu stran písemky nepočítají.
    const total = Number(/strana 1 \/ (\d+)/.exec(text)?.[1])
    expect(text).toContain(`strana ${total} / ${total}`)
    expect(text).not.toContain(`strana ${total + 1} /`)
  })
})
