/** Ad-hoc analytický test: vygeneruje ukázky se všemi 10 typy otázek. */
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToFile } from '@react-pdf/renderer'
import { it } from 'vitest'
import { TestDocument } from '../src/pdf/TestDocument'
import { registerServerFonts } from '../src/pdf/node'
import { makeItems, makeTemplate, makeTest, makeQuestion } from './fixtures'
import type { Question } from '../src/schema/question'
import type { ResolvedTestItem } from '../src/schema/test'

registerServerFonts()
const OUT = resolve(import.meta.dirname, 'tmp')

// 1x1 red pixel PNG as data URL, stand-in for a real photo/diagram.
const TINY_PNG = 'data:image/png;base64,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'

const extra: Question[] = [
  makeQuestion({
    type: 'label_image',
    points: 3,
    payload: {
      prompt: 'Popiš očíslované části obrázku.',
      assetId: 'img-1',
      labels: ['Nos', 'Hrtan', 'Průdušnice'],
    },
  }),
]

const allQuestions = [...extra]

it.runIf(process.env.RENDER_SAMPLES)('vygeneruje plnou ukázku se všemi typy', async () => {
  mkdirSync(OUT, { recursive: true })

  const items: ResolvedTestItem[] = [
    ...makeItems(),
    { id: 'instr-1', testId: 'test-1', order: 90, kind: 'instruction', questionId: null, text: 'Pozorně si přečti obrázek a doplň popisky.', pointsOverride: null },
    { id: 'pb-1', testId: 'test-1', order: 91, kind: 'page_break', questionId: null, text: null, pointsOverride: null },
    { id: 'h2', testId: 'test-1', order: 92, kind: 'heading', questionId: null, text: 'Část B – Obrázek', pointsOverride: null },
    ...allQuestions.map((q, i) => ({
      id: `extra-${i}`,
      testId: 'test-1',
      order: 93 + i,
      kind: 'question' as const,
      questionId: q.id,
      text: null,
      pointsOverride: null,
      question: q,
    })),
  ]

  for (const slug of ['klasicka', 'kompaktni', 'pracovni-list']) {
    for (const variant of ['A', 'B'] as const) {
      await renderToFile(
        createElement(TestDocument, {
          test: makeTest({ graded: slug !== 'pracovni-list' }),
          template: makeTemplate(slug),
          items,
          variant,
          withKey: true,
          assets: { 'img-1': TINY_PNG },
        }) as never,
        resolve(OUT, `full-${slug}-${variant}.pdf`),
      )
    }
  }
})
