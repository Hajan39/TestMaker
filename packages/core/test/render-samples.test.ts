/** Pomocný test: vygeneruje ukázková PDF do `test/tmp` pro vizuální kontrolu. */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToFile } from '@react-pdf/renderer'
import { it } from 'vitest'
import { TestDocument } from '../src/pdf/TestDocument'
import { registerServerFonts } from '../src/pdf/node'
import { makeItems, makeTemplate, makeTest } from './fixtures'

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
