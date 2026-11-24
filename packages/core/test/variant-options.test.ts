import { describe, expect, it } from 'vitest'
import { buildVariant } from '../src/pdf/shuffle'
import { parseVariantOptions, variantOptionsSchema, type ResolvedTestItem } from '../src/schema/test'
import { sampleQuestions } from './fixtures'
import { fixtureItems, signature } from './variant-fixture'

const questionIds = (items: ResolvedTestItem[]) => items.filter((i) => i.kind === 'question').map((i) => i.id)

describe('variant B options', () => {
  it('default options give exactly the variant B printed before the options existed', () => {
    // Captured from the implementation without options — already printed papers must not change.
    expect(signature(buildVariant(fixtureItems(), 'B', 'test-1'))).toEqual({
      ids: ['h1', 'q3', 'q2', 'i1', 'q1', 'q0', 'pb', 'q5', 'q4', 'q6'],
      options: {
        q3: [
          { text: 'Plíce jsou sval.', isTrue: false },
          { text: 'Hrtan je tvořen chrupavkami.', isTrue: true },
        ],
        q2: null,
        q1: ['Průdušinky', 'Dutina nosní', 'Plicní sklípky', 'Nosohltan'],
        q0: ['V průdušnici', 'V nosohltanu', 'V plicních sklípcích', 'V hrtanu'],
        q5: ['Tvorba hlasu', 'Vedení vzduchu', 'Výměna plynů'],
        q4: null,
        q6: null,
      },
    })
    expect(buildVariant(fixtureItems(), 'B', 'abc', { order: 'shuffle', shuffleOptions: true, seed: 0 }).map((i) => i.id)).toEqual(
      ['h1', 'q1', 'q3', 'i1', 'q0', 'q2', 'pb', 'q6', 'q4', 'q5'],
    )
  })

  it('reverse reverses questions per section and keeps headings, breaks and instructions in place', () => {
    const variantB = buildVariant(fixtureItems(), 'B', 'test-1', { order: 'reverse', shuffleOptions: false })
    expect(variantB.map((i) => i.id)).toEqual(['h1', 'q3', 'q2', 'i1', 'q1', 'q0', 'pb', 'q6', 'q5', 'q4'])
  })

  it('reverse leaves a section with a single question unchanged', () => {
    const items = fixtureItems().filter((i) => ['h1', 'q0', 'pb', 'q4', 'q5'].includes(i.id))
    const variantB = buildVariant(items, 'B', 'test-1', { order: 'reverse', shuffleOptions: false })
    expect(variantB.map((i) => i.id)).toEqual(['h1', 'q0', 'pb', 'q5', 'q4'])
  })

  it('without option shuffling questions keep the options of variant A', () => {
    const optionsA = signature(fixtureItems()).options
    for (const order of ['shuffle', 'reverse'] as const) {
      const variantB = buildVariant(fixtureItems(), 'B', 'test-1', { order, shuffleOptions: false })
      expect(signature(variantB).options, order).toEqual(optionsA)
    }
  })

  it('reverse with option shuffling keeps the correct answer of each question', () => {
    const single = sampleQuestions.find((q) => q.type === 'single_choice')!
    if (single.type !== 'single_choice') throw new Error('type')
    const variantB = buildVariant(fixtureItems(), 'B', 'test-1', { order: 'reverse', shuffleOptions: true })
    const shuffled = variantB.find((i) => i.id === 'q0')!.question!
    if (shuffled.type !== 'single_choice') throw new Error('type')
    expect(shuffled.payload.options).not.toEqual(single.payload.options)
    expect(shuffled.payload.options[shuffled.payload.correctIndex]).toBe(
      single.payload.options[single.payload.correctIndex],
    )
    // Deterministic: the key rendered by a second request matches the paper.
    expect(signature(buildVariant(fixtureItems(), 'B', 'test-1', { order: 'reverse' }))).toEqual(signature(variantB))
  })

  it('a new seed changes the order, deterministically', () => {
    const seed0 = questionIds(buildVariant(fixtureItems(), 'B', 'test-1', { seed: 0 }))
    const seed1 = questionIds(buildVariant(fixtureItems(), 'B', 'test-1', { seed: 1 }))
    const seed2 = questionIds(buildVariant(fixtureItems(), 'B', 'test-1', { seed: 2 }))
    expect(seed1).not.toEqual(seed0)
    expect(seed2).not.toEqual(seed1)
    expect(questionIds(buildVariant(fixtureItems(), 'B', 'test-1', { seed: 1 }))).toEqual(seed1)
  })

  it('parses stored options with defaults and rejects invalid ones', () => {
    expect(parseVariantOptions(null)).toEqual({ order: 'shuffle', shuffleOptions: true, seed: 0 })
    expect(parseVariantOptions({ order: 'reverse' })).toEqual({ order: 'reverse', shuffleOptions: true, seed: 0 })
    expect(parseVariantOptions({ order: 'sideways' })).toEqual({ order: 'shuffle', shuffleOptions: true, seed: 0 })
    expect(variantOptionsSchema.safeParse({ seed: -1 }).success).toBe(false)
    expect(variantOptionsSchema.safeParse({ seed: 1.5 }).success).toBe(false)
  })
})
