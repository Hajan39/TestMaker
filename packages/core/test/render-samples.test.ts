/**
 * Sample PDFs into `test/tmp` for visual inspection — run explicitly:
 *
 *     RENDER_SAMPLES=1 pnpm exec vitest run test/render-samples.test.ts
 *
 * The samples are the main purpose, but each is also checked: the file must
 * exist, be a real PDF and contain the text the sample is made for. Otherwise
 * nobody would notice an empty or broken sample before reaching the printer.
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
import { puzzleContentSchema } from '../src/schema/puzzle'
import { makeItems, makeQuestion, makeTemplate, makeTest, makeWorksheetItems, TALL_IMAGE_DATA_URL } from './fixtures'

registerServerFonts()
const OUT = resolve(import.meta.dirname, 'tmp')

/**
 * A red 1 × 1 px square standing in for a real image — a `label_image`
 * question without an attachment has nothing to render.
 */
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** Checks that the file exists, is a PDF and contains the expected text. */
async function checkSample(path: string, expectedText: string[]): Promise<void> {
  const buffer = readFileSync(path)
  expect(buffer.subarray(0, 5).toString(), path).toBe('%PDF-')
  expect(buffer.length, path).toBeGreaterThan(5000)

  const { text } = await extractPdf(new Uint8Array(buffer))
  for (const needle of expectedText) expect(text, path).toContain(needle)
}

it.runIf(process.env.RENDER_SAMPLES)('generates samples of all templates', async () => {
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
 * Sample for visually checking the header (teacher, note) and question images
 * (missing attachment, image with an extreme aspect ratio).
 */
it.runIf(process.env.RENDER_SAMPLES)('generates a header and images sample', async () => {
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
  // This is why the sample exists: teacher, class and note must be printed.
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
  // A missing attachment must neither crash the question nor drop it from the test.
  await checkSample(imagePath, ['příloha schválně chybí', 'velmi vysoký poměr stran'])
})

/**
 * Sample with an image caption, an instruction and a manual page break —
 * elements missing from the samples above that commonly meet in a test.
 */
it.runIf(process.env.RENDER_SAMPLES)('generates a sample with an image question and a page break', async () => {
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

/**
 * Sample with puzzles — a word search and a cryptogram in one test, with a key.
 * The grid is exactly the content that breaks across pages, so it must be
 * checked by eye on the generated PDF, not just by types.
 */
it.runIf(process.env.RENDER_SAMPLES)('generates a puzzles sample', async () => {
  mkdirSync(OUT, { recursive: true })

  const wordsearch = puzzleContentSchema.parse({
    kind: 'wordsearch',
    title: 'Osmisměrka: části rostliny',
    entries: [
      { word: 'kořen', clue: 'Poutá rostlinu v půdě' },
      { word: 'stonek', clue: 'Nese listy a květy' },
      { word: 'list', clue: 'Probíhá v něm fotosyntéza' },
      { word: 'květ', clue: 'Slouží k rozmnožování' },
      { word: 'plod', clue: 'Vzniká z květu' },
      { word: 'semeno', clue: 'Vyroste z něj nová rostlina' },
      { word: 'pyl', clue: 'Přenáší ho včely' },
      { word: 'chloroplast', clue: 'Zelené tělísko v buňce' },
    ],
    payload: { cols: 14, rows: 14, seed: 'ukazka' },
  })

  const cryptogram = puzzleContentSchema.parse({
    kind: 'cryptogram',
    title: 'Tajenka: co rostlina potřebuje',
    entries: [
      { word: 'kořen', clue: 'Poutá rostlinu v půdě' },
      { word: 'stonek', clue: 'Nese listy a květy' },
      { word: 'list', clue: 'Probíhá v něm fotosyntéza' },
      { word: 'plod', clue: 'Vzniká z květu' },
      { word: 'semeno', clue: 'Vyroste z něj rostlina' },
      { word: 'voda', clue: 'Bez ní rostlina uschne' },
      { word: 'světlo', clue: 'Pohání fotosyntézu' },
      { word: 'půda', clue: 'Roste v ní kořen' },
    ],
    payload: { phrase: 'pod list', seed: 'ukazka' },
  })

  const items: ResolvedTestItem[] = [
    ...makeItems().slice(0, 2),
    { id: 'pz-1', testId: 'test-1', order: 80, kind: 'puzzle', questionId: null, text: null, pointsOverride: null, puzzleId: 'p1', puzzle: wordsearch },
    { id: 'pz-2', testId: 'test-1', order: 81, kind: 'puzzle', questionId: null, text: null, pointsOverride: null, puzzleId: 'p2', puzzle: cryptogram },
  ]

  const path = resolve(OUT, 'puzzles.pdf')
  await renderToFile(
    createElement(TestDocument, {
      test: makeTest({ graded: false }),
      template: makeTemplate('klasicka'),
      items,
      variant: 'A',
      withKey: true,
      assets: {},
    }) as never,
    path,
  )
  await checkSample(path, ['Osmisměrka: části rostliny', 'CHLOROPLAST', 'Tajenka', 'Řešení'])
  // The key must have filled boxes: the template line height used to wipe
  // letters from the cells entirely and an empty key grid would only be
  // noticed at the printer.
  const { text } = await extractPdf(new Uint8Array(readFileSync(path)))
  expect(text).toContain('P O D L I S T')
})

/**
 * Worksheet: text, a boxed fun fact, a task and two tables, the second of which
 * does not fit a page — it must break by rows and repeat the header on the
 * next page. That can only be judged by eye on the generated PDF.
 */
it.runIf(process.env.RENDER_SAMPLES)('generates a worksheet sample', async () => {
  mkdirSync(OUT, { recursive: true })
  const [first, ...rest] = makeWorksheetItems(4)
  const question = makeItems().find((item) => item.kind === 'question')!
  const items: ResolvedTestItem[] = [
    first!,
    ...rest,
    { ...question, id: 'w-q', questionId: null },
    ...makeWorksheetItems(12, true).slice(3).map((item) => ({ ...item, id: 'w-tab-2' })),
    // A further page after the table: the table header must not repeat on it.
    { ...first!, id: 'w-pb', kind: 'page_break', text: null },
    { ...first!, id: 'w-h2', text: 'Za tabulkou' },
  ]
  const path = resolve(OUT, 'worksheet.pdf')
  await renderToFile(
    createElement(TestDocument, {
      test: makeTest({ graded: false, kind: 'pracovni_list', variants: 1, title: 'Pracovní list – dýchání' }),
      template: makeTemplate('pracovni-list'),
      items,
      variant: 'A',
      withKey: true,
      assets: {},
    }) as never,
    path,
  )
  await checkSample(path, ['Věděli jste?', 'Doplň tabulku orgánů', 'funkce 12'])
})
