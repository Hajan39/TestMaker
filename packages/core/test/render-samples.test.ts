/** Pomocný test: vygeneruje ukázková PDF do `test/tmp` pro vizuální kontrolu. */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToFile } from '@react-pdf/renderer'
import { it } from 'vitest'
import { TestDocument } from '../src/pdf/TestDocument'
import { registerServerFonts } from '../src/pdf/node'
import { makeItems, makeQuestion, makeTemplate, makeTest, TALL_IMAGE_DATA_URL } from './fixtures'

registerServerFonts()
const OUT = resolve(import.meta.dirname, 'tmp')

it.runIf(process.env.RENDER_SAMPLES)('vygeneruje ukázky', async () => {
  mkdirSync(OUT, { recursive: true })
  for (const slug of ['klasicka', 'kompaktni', 'pracovni-list']) {
    for (const variant of ['A', 'B'] as const) {
      await renderToFile(
        createElement(TestDocument, {
          test: makeTest({ graded: slug !== 'pracovni-list' }),
          template: makeTemplate(slug),
          items: makeItems(),
          variant,
          withKey: true,
          assets: {},
        }) as never,
        resolve(OUT, `${slug}-${variant}.pdf`),
      )
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
  await renderToFile(
    createElement(TestDocument, {
      test: testWithHeader,
      template: makeTemplate('klasicka'),
      items: makeItems().slice(0, 2),
      variant: 'A',
      withKey: false,
      assets: {},
    }) as never,
    resolve(OUT, 'header-check.pdf'),
  )

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
  await renderToFile(
    createElement(TestDocument, {
      test: makeTest({ graded: false }),
      template: makeTemplate('klasicka'),
      items: makeItems([missingImageQuestion, tallImageQuestion]),
      variant: 'A',
      withKey: false,
      assets: { 'tall-1': TALL_IMAGE_DATA_URL },
    }) as never,
    resolve(OUT, 'image-check.pdf'),
  )
})
