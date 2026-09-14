import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { TestDocument } from '../src/pdf/TestDocument'
import { registerServerFonts } from '../src/pdf/node'
import { buildVariant } from '../src/pdf/shuffle'
import { formatAnswer } from '../src/pdf/answerKey'
import { makeItems, makeTemplate, makeTest, sampleQuestions } from './fixtures'

registerServerFonts()

async function render(props: Parameters<typeof TestDocument>[0]) {
  return renderToBuffer(createElement(TestDocument, props) as never)
}

describe('PDF renderer', () => {
  it('vykreslí test se všemi typy otázek na A4', async () => {
    const buffer = await render({
      test: makeTest(),
      template: makeTemplate(),
      items: makeItems(),
      variant: 'A',
      withKey: true,
      assets: {},
    })
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buffer.length).toBeGreaterThan(5000)
  })

  it('projde všemi vestavěnými šablonami', async () => {
    for (const slug of ['klasicka', 'kompaktni', 'pracovni-list']) {
      const buffer = await render({
        test: makeTest(),
        template: makeTemplate(slug),
        items: makeItems(),
        variant: 'A',
        withKey: false,
        assets: {},
      })
      expect(buffer.subarray(0, 5).toString(), slug).toBe('%PDF-')
    }
  })

  it('test bez známek se vykreslí', async () => {
    const buffer = await render({
      test: makeTest({ graded: false }),
      template: makeTemplate(),
      items: makeItems(),
      variant: 'A',
      withKey: true,
      assets: {},
    })
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  })
})

describe('varianta B', () => {
  it('změní pořadí otázek, ale zachová nadpisy na místě', () => {
    const items = makeItems()
    const variantB = buildVariant(items, 'B', 'test-1')
    expect(variantB[0]?.kind).toBe('heading')
    expect(variantB.length).toBe(items.length)
    const orderA = items.filter((i) => i.kind === 'question').map((i) => i.questionId)
    const orderB = variantB.filter((i) => i.kind === 'question').map((i) => i.questionId)
    expect(orderB).not.toEqual(orderA)
    expect([...orderB].sort()).toEqual([...orderA].sort())
  })

  it('je deterministická', () => {
    const a = buildVariant(makeItems(), 'B', 'test-1').map((i) => i.questionId)
    const b = buildVariant(makeItems(), 'B', 'test-1').map((i) => i.questionId)
    expect(a).toEqual(b)
  })

  it('přeházené možnosti mají správně přepočítaný klíč', () => {
    const original = sampleQuestions.find((q) => q.type === 'single_choice')!
    const items = buildVariant(makeItems([original]), 'B', 'test-1')
    const shuffledQuestion = items.find((i) => i.kind === 'question')!.question!
    if (shuffledQuestion.type !== 'single_choice' || original.type !== 'single_choice') throw new Error('typ')
    expect(shuffledQuestion.payload.options[shuffledQuestion.payload.correctIndex]).toBe(
      original.payload.options[original.payload.correctIndex],
    )
  })
})

describe('klíč', () => {
  it('formátuje odpovědi všech typů', () => {
    for (const question of sampleQuestions) {
      const answer = formatAnswer(question, 'A')
      expect(answer.length, question.type).toBeGreaterThan(0)
    }
    const single = sampleQuestions.find((q) => q.type === 'single_choice')!
    expect(formatAnswer(single, 'A')).toContain('plicních sklípcích')
  })
})
