import { describe, expect, it } from 'vitest'
import type { ResolvedTestItem } from '../src/schema/test'
import { estimateHeight, paginate } from '../src/pdf/estimate'
import { makeItems, makeQuestion, makeTemplate } from './fixtures'

const template = makeTemplate()

describe('estimateHeight', () => {
  it('an open answer takes more space than a multiple choice', () => {
    const items = makeItems()
    const open = items.find((i) => i.question?.type === 'open')!
    const choice = items.find((i) => i.question?.type === 'single_choice')!
    expect(estimateHeight(open, template.config)).toBeGreaterThan(
      estimateHeight(choice, template.config),
    )
  })

  it('draw-and-label takes space by line count, just like an open answer', () => {
    const item = (type: 'open' | 'draw'): ResolvedTestItem => ({
      id: 'i1',
      testId: 't',
      order: 0,
      kind: 'question',
      questionId: 'q1',
      text: null,
      pointsOverride: null,
      linesOverride: null,
      question: makeQuestion({ type, points: 1, payload: { prompt: 'Nakresli buňku.', lines: 8, answer: 'x' } }),
    })
    expect(estimateHeight(item('draw'), template.config)).toBe(estimateHeight(item('open'), template.config))
  })

  it('a page break has no height', () => {
    const brk = { id: 'b', testId: 't', order: 0, kind: 'page_break' as const, questionId: null, text: null, pointsOverride: null }
    expect(estimateHeight(brk, template.config)).toBe(0)
  })

  it('the line count override in the test wins over the question', () => {
    const question = makeQuestion({
      type: 'open' as const,
      points: 1,
      payload: { prompt: 'Popiš dýchání.', lines: 2, answer: 'x' },
    })
    const short: ResolvedTestItem = {
      id: 'i1',
      testId: 't',
      order: 0,
      kind: 'question',
      questionId: 'q1',
      text: null,
      pointsOverride: null,
      linesOverride: null,
      question,
    }
    const long: ResolvedTestItem = { ...short, id: 'i2', linesOverride: 10 }

    expect(estimateHeight(long, template.config)).toBeGreaterThan(
      estimateHeight(short, template.config),
    )
  })

  it('a question with an image attachment takes more than the same question without it', () => {
    const base = { type: 'open' as const, points: 1, payload: { prompt: 'Popiš obrázek.', lines: 2, answer: 'x' } }
    const withoutImage: ResolvedTestItem = {
      id: 'i1',
      testId: 't',
      order: 0,
      kind: 'question',
      questionId: 'q1',
      text: null,
      pointsOverride: null,
      question: makeQuestion(base),
    }
    const withImage: ResolvedTestItem = {
      ...withoutImage,
      id: 'i2',
      questionId: 'q2',
      question: makeQuestion({ ...base, blocks: [{ kind: 'image', assetId: 'a1', widthPercent: 100 }] }),
    }
    expect(estimateHeight(withImage, template.config)).toBeGreaterThan(
      estimateHeight(withoutImage, template.config),
    )
  })
})

describe('paginate', () => {
  it('a short test fits on one page', () => {
    expect(paginate(makeItems().slice(0, 3), template.config)).toHaveLength(1)
  })

  it('a page break starts a new page', () => {
    const items = makeItems().slice(0, 3)
    const brk = { id: 'b', testId: 't', order: 99, kind: 'page_break' as const, questionId: null, text: null, pointsOverride: null }
    const pages = paginate([...items, brk, ...items], template.config)
    expect(pages.length).toBeGreaterThanOrEqual(2)
  })

  it('the test header takes space only on the first page, so fewer items fit there', () => {
    const heading = (i: number): ResolvedTestItem => ({
      id: `h${i}`,
      testId: 't',
      order: i,
      kind: 'heading',
      questionId: null,
      text: 'Část',
      pointsOverride: null,
    })
    const items = Array.from({ length: 45 }, (_, i) => heading(i))
    const pages = paginate(items, template.config)
    expect(pages.length).toBeGreaterThanOrEqual(2)
    expect(pages[0]!.length).toBeLessThan(pages[1]!.length)
  })
})
