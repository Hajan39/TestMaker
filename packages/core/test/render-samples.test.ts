/**
 * Ukázková PDF do `test/tmp` pro vizuální kontrolu — spouští se výslovně:
 *
 *     RENDER_SAMPLES=1 pnpm exec vitest run test/render-samples.test.ts
 *
 * Ukázky jsou hlavní účel, ale každá se zároveň ověří: soubor musí vzniknout,
 * být to skutečné PDF a obsahovat text, kvůli kterému se ukázka dělá. Bez
 * toho by si prázdné nebo rozsypané ukázky nikdo nevšiml dřív než u tiskárny.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToFile } from '@react-pdf/renderer'
import { expect, it } from 'vitest'
import { TestDocument } from '../src/pdf/TestDocument'
import { registerServerFonts } from '../src/pdf/node'
import { extractPdf } from '../src/extract/pdf'
import type { ResolvedTestItem } from '../src/schema/test'
import { makeItems, makeQuestion, makeTemplate, makeTest, TALL_IMAGE_DATA_URL } from './fixtures'

registerServerFonts()
const OUT = resolve(import.meta.dirname, 'tmp')

/**
 * Červený čtverec 1 × 1 px jako zástupce skutečného obrázku — otázka typu
 * `label_image` bez přílohy nemá co vykreslit.
 */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** Ověří, že soubor vznikl, je to PDF a je v něm očekávaný text. */
async function checkSample(path: string, expectedText: string[]): Promise<void> {
  const buffer = readFileSync(path)
  expect(buffer.subarray(0, 5).toString(), path).toBe('%PDF-')
  expect(buffer.length, path).toBeGreaterThan(5000)

  const { text } = await extractPdf(new Uint8Array(buffer))
  for (const needle of expectedText) expect(text, path).toContain(needle)
}

it.runIf(process.env.RENDER_SAMPLES)('vygeneruje ukázky všech šablon', async () => {
  mkdirSync(OUT, { recursive: true })
  for (const slug of ['klasicka', 'kompaktni', 'pracovni-list']) {
    for (const variant of ['A', 'B'] as const) {
      const path = resolve(OUT, `${slug}-${variant}.pdf`)
      await renderToFile(
        createElement(TestDocument, {
          test: makeTest({ graded: slug !== 'pracovni-list' }),
          template: makeTemplate(slug),
          items: makeItems(),
          variant,
          withKey: true,
          assets: {},
        }) as never,
        path,
      )
      await checkSample(path, ['Dýchací soustava', 'Část A – Stavba dýchací soustavy'])
    }
  }
})

/**
 * Ukázka pro vizuální kontrolu hlavičky (vyučující, poznámka) a obrázků
 * v otázce (chybějící příloha, obrázek s extrémním poměrem stran).
 */
it.runIf(process.env.RENDER_SAMPLES)('vygeneruje ukázku hlavičky a obrázků', async () => {
  mkdirSync(OUT, { recursive: true })

  const testWithHeader = makeTest({
    header: {
      school: 'ZŠ Ukázková',
      subject: 'Přírodopis',
      className: '8.A',
      teacher: 'Mgr. Nováková',
      date: '15. 9. 2026',
      note: 'Bez kalkulačky, čas 40 minut.',
    },
  })
  const headerPath = resolve(OUT, 'header-check.pdf')
  await renderToFile(
    createElement(TestDocument, {
      test: testWithHeader,
      template: makeTemplate('klasicka'),
      items: makeItems().slice(0, 2),
      variant: 'A',
      withKey: false,
      assets: {},
    }) as never,
    headerPath,
  )
  // Kvůli tomu ukázka vzniká: vyučující, třída i poznámka se musí vytisknout.
  await checkSample(headerPath, ['Mgr. Nováková', '8.A', 'Bez kalkulačky'])

  const missingImageQuestion = makeQuestion({
    type: 'short_answer',
    payload: { prompt: 'Popiš obrázek (příloha schválně chybí).', answer: 'x', acceptedAnswers: [] },
    blocks: [{ kind: 'image', assetId: 'missing', widthPercent: 100 }],
  })
  const tallImageQuestion = makeQuestion({
    type: 'short_answer',
    payload: { prompt: 'Popiš obrázek (velmi vysoký poměr stran).', answer: 'x', acceptedAnswers: [] },
    blocks: [{ kind: 'image', assetId: 'tall-1', widthPercent: 60 }],
  })
  const imagePath = resolve(OUT, 'image-check.pdf')
  await renderToFile(
    createElement(TestDocument, {
      test: makeTest({ graded: false }),
      template: makeTemplate('klasicka'),
      items: makeItems([missingImageQuestion, tallImageQuestion]),
      variant: 'A',
      withKey: false,
      assets: { 'tall-1': TALL_IMAGE_DATA_URL },
    }) as never,
    imagePath,
  )
  // Chybějící příloha nesmí otázku shodit ani ji vynechat ze zadání.
  await checkSample(imagePath, ['příloha schválně chybí', 'velmi vysoký poměr stran'])
})

/**
 * Ukázka s popisem obrázku, instrukcí a ručním zalomením strany — dohromady
 * to jsou prvky, které v ukázkách výš nejsou a v písemce se přitom běžně
 * potkají.
 */
it.runIf(process.env.RENDER_SAMPLES)('vygeneruje ukázku s obrázkovou otázkou a zalomením', async () => {
  mkdirSync(OUT, { recursive: true })

  const labelImage = makeQuestion({
    type: 'label_image',
    points: 3,
    payload: {
      prompt: 'Popiš očíslované části obrázku.',
      assetId: 'img-1',
      labels: ['Nos', 'Hrtan', 'Průdušnice'],
    },
  })

  const items: ResolvedTestItem[] = [
    ...makeItems(),
    { id: 'instr-1', testId: 'test-1', order: 90, kind: 'instruction', questionId: null, text: 'Pozorně si přečti obrázek a doplň popisky.', pointsOverride: null },
    { id: 'pb-1', testId: 'test-1', order: 91, kind: 'page_break', questionId: null, text: null, pointsOverride: null },
    { id: 'h2', testId: 'test-1', order: 92, kind: 'heading', questionId: null, text: 'Část B – Obrázek', pointsOverride: null },
    { id: 'extra-0', testId: 'test-1', order: 93, kind: 'question', questionId: labelImage.id, text: null, pointsOverride: null, question: labelImage },
  ]

  for (const slug of ['klasicka', 'kompaktni', 'pracovni-list']) {
    for (const variant of ['A', 'B'] as const) {
      const path = resolve(OUT, `full-${slug}-${variant}.pdf`)
      await renderToFile(
        createElement(TestDocument, {
          test: makeTest({ graded: slug !== 'pracovni-list' }),
          template: makeTemplate(slug),
          items,
          variant,
          withKey: true,
          assets: { 'img-1': TINY_PNG },
        }) as never,
        path,
      )
      await checkSample(path, ['Pozorně si přečti obrázek', 'Část B – Obrázek', 'Popiš očíslované části obrázku.'])
    }
  }
})
