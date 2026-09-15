import { describe, expect, it } from 'vitest'
import { estimateHeight, paginate } from '../src/pdf/estimate'
import { makeItems, makeTemplate } from './fixtures'

const template = makeTemplate()

describe('estimateHeight', () => {
  it('volná odpověď zabere víc než výběr z možností', () => {
    const items = makeItems()
    const open = items.find((i) => i.question?.type === 'open')!
    const choice = items.find((i) => i.question?.type === 'single_choice')!
    expect(estimateHeight(open, template.config)).toBeGreaterThan(
      estimateHeight(choice, template.config),
    )
  })

  it('zalomení strany nemá výšku', () => {
    const brk = { id: 'b', testId: 't', order: 0, kind: 'page_break' as const, questionId: null, text: null, pointsOverride: null }
    expect(estimateHeight(brk, template.config)).toBe(0)
  })
})

describe('paginate', () => {
  it('krátký test se vejde na jednu stranu', () => {
    expect(paginate(makeItems().slice(0, 3), template.config)).toHaveLength(1)
  })

  it('zalomení strany začne novou stranu', () => {
    const items = makeItems().slice(0, 3)
    const brk = { id: 'b', testId: 't', order: 99, kind: 'page_break' as const, questionId: null, text: null, pointsOverride: null }
    const pages = paginate([...items, brk, ...items], template.config)
    expect(pages.length).toBeGreaterThanOrEqual(2)
  })
})
