import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { TestDocument } from '../src/pdf/TestDocument'
import { registerServerFonts } from '../src/pdf/node'
import { buildVariant, displayOrder, shuffleQuestion } from '../src/pdf/shuffle'
import { formatAnswer } from '../src/pdf/answerKey'
import { questionContentSchema } from '../src/schema/question'
import { sanitizeText } from '../src/pdf/text'
import { extractPdf } from '../src/extract/pdf'
import { makeItems, makeQuestion, makeTemplate, makeTest, sampleQuestions, TALL_IMAGE_DATA_URL } from './fixtures'
import { resolveTestItemQuestion, serializeQuestionSnapshot } from '../src/schema/test'
import type { ResolvedTestItem } from '../src/schema/test'

registerServerFonts()

async function render(props: Parameters<typeof TestDocument>[0]) {
  return renderToBuffer(createElement(TestDocument, props) as never)
}

async function renderText(props: Parameters<typeof TestDocument>[0]): Promise<string> {
  const buffer = await render(props)
  const { text } = await extractPdf(new Uint8Array(buffer))
  return text
}

describe('PDF renderer', () => {
  it('renders a test with all question types on A4', async () => {
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

  it('works with every built-in template', async () => {
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

  it('renders an ungraded test', async () => {
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

describe('variant B', () => {
  it('changes question order but keeps headings in place', () => {
    const items = makeItems()
    const variantB = buildVariant(items, 'B', 'test-1')
    expect(variantB[0]?.kind).toBe('heading')
    expect(variantB.length).toBe(items.length)
    const orderA = items.filter((i) => i.kind === 'question').map((i) => i.questionId)
    const orderB = variantB.filter((i) => i.kind === 'question').map((i) => i.questionId)
    expect(orderB).not.toEqual(orderA)
    expect([...orderB].sort()).toEqual([...orderA].sort())
  })

  it('is deterministic', () => {
    const a = buildVariant(makeItems(), 'B', 'test-1').map((i) => i.questionId)
    const b = buildVariant(makeItems(), 'B', 'test-1').map((i) => i.questionId)
    expect(a).toEqual(b)
  })

  it('shuffled options have a correctly recomputed key', () => {
    const original = sampleQuestions.find((q) => q.type === 'single_choice')!
    const items = buildVariant(makeItems([original]), 'B', 'test-1')
    const shuffledQuestion = items.find((i) => i.kind === 'question')!.question!
    if (shuffledQuestion.type !== 'single_choice' || original.type !== 'single_choice') throw new Error('typ')
    expect(shuffledQuestion.payload.options[shuffledQuestion.payload.correctIndex]).toBe(
      original.payload.options[original.payload.correctIndex],
    )
  })

  it('guarantees a different option order even if chance alone returned the same order', () => {
    // Fisher–Yates with a generator that always returns a value just below 1
    // picks itself at every step — without the guarantee the shuffle would change nothing.
    const noopRand = () => 0.999999
    const original = sampleQuestions.find((q) => q.type === 'single_choice')!
    if (original.type !== 'single_choice') throw new Error('typ')
    const result = shuffleQuestion(original, noopRand)
    if (result.type !== 'single_choice') throw new Error('typ')
    expect(result.payload.options).not.toEqual(original.payload.options)
    // The key still points at the correct answer after the forced swap.
    expect(result.payload.options[result.payload.correctIndex]).toBe(
      original.payload.options[original.payload.correctIndex],
    )
  })

  it('with two options variant B order always differs from variant A', () => {
    // A question with only two options is the most critical case: a random
    // shuffle has a 50% chance of returning the same order. Try enough test
    // IDs for that chance to show, and check it never happens.
    const twoOptions = makeQuestion({
      type: 'single_choice',
      payload: { prompt: 'Je Praha hlavní město ČR?', options: ['Ano', 'Ne'], correctIndex: 0 },
    })
    if (twoOptions.type !== 'single_choice') throw new Error('typ')
    const originalOptions = twoOptions.payload.options
    for (let i = 0; i < 200; i += 1) {
      const items = buildVariant(makeItems([twoOptions]), 'B', `test-${i}`)
      const question = items.find((it) => it.kind === 'question')!.question!
      if (question.type !== 'single_choice') throw new Error('typ')
      expect(question.payload.options, `test-${i}`).not.toEqual(originalOptions)
    }
  })

  it('in a short section (two questions) the order always differs from variant A', () => {
    const shortSection = sampleQuestions.slice(0, 2)
    for (let i = 0; i < 200; i += 1) {
      const items = makeItems(shortSection)
      const variantB = buildVariant(items, 'B', `test-${i}`)
      const orderA = items.filter((it) => it.kind === 'question').map((it) => it.questionId)
      const orderB = variantB.filter((it) => it.kind === 'question').map((it) => it.questionId)
      expect(orderB, `test-${i}`).not.toEqual(orderA)
    }
  })

  it('an instruction in the middle of a section does not block swapping questions around it', () => {
    const q1 = makeQuestion({ type: 'short_answer', payload: { prompt: 'Otázka 1', answer: 'a', acceptedAnswers: [] } })
    const q2 = makeQuestion({ type: 'short_answer', payload: { prompt: 'Otázka 2', answer: 'b', acceptedAnswers: [] } })
    const items: ResolvedTestItem[] = [
      { id: 'h', testId: 't', order: 0, kind: 'heading', questionId: null, text: 'Část', pointsOverride: null },
      {
        id: 'i1',
        testId: 't',
        order: 1,
        kind: 'question',
        questionId: q1.id,
        text: null,
        pointsOverride: null,
        question: q1,
      },
      {
        id: 'instr',
        testId: 't',
        order: 2,
        kind: 'instruction',
        questionId: null,
        text: 'Otázky 1–2 se vztahují ke stejnému tématu.',
        pointsOverride: null,
      },
      {
        id: 'i2',
        testId: 't',
        order: 3,
        kind: 'question',
        questionId: q2.id,
        text: null,
        pointsOverride: null,
        question: q2,
      },
    ]

    // The instruction always stays in its place in the sequence...
    for (const testId of ['a', 'b', 'c']) {
      const variantB = buildVariant(items, 'B', testId)
      expect(variantB[2]?.kind, testId).toBe('instruction')
    }

    // ...but for some test variant the question after the instruction lands
    // before the one originally before it — if the instruction split the
    // section in two, this would never happen.
    const sawSwap = Array.from({ length: 300 }, (_, i) => `test-${i}`).some((testId) => {
      const variantB = buildVariant(items, 'B', testId)
      const order = variantB.filter((it) => it.kind === 'question').map((it) => it.questionId)
      return order[0] === q2.id
    })
    expect(sawSwap).toBe(true)
  })
})

describe('answer key', () => {
  it('formats answers of all types', () => {
    for (const question of sampleQuestions) {
      const answer = formatAnswer(question, 'A')
      expect(answer.length, question.type).toBeGreaterThan(0)
    }
    const single = sampleQuestions.find((q) => q.type === 'single_choice')!
    expect(formatAnswer(single, 'A')).toContain('plicních sklípcích')
  })
})

describe('sanitizeText', () => {
  it('leaves ordinary Czech text unchanged', () => {
    expect(sanitizeText('Příliš žluťoučký kůň úpěl ďábelské ódy.')).toBe(
      'Příliš žluťoučký kůň úpěl ďábelské ódy.',
    )
  })

  it('replaces an arrow with a readable substitute', () => {
    expect(sanitizeText('nos → nosohltan → hrtan')).toBe('nos -> nosohltan -> hrtan')
  })

  it('replaces other characters missing from the font too (maths symbols, check marks)', () => {
    expect(sanitizeText('a ≠ b')).toBe('a != b')
    expect(sanitizeText('x ≤ 5')).toBe('x <= 5')
    expect(sanitizeText('✓ hotovo')).toBe('[ano] hotovo')
  })

  it('replaces an unknown character missing from the font with a readable question mark, not a tofu glyph', () => {
    // Emoji and other characters outside our map — a generic fallback so no
    // empty/tofu glyph appears even for characters we did not anticipate.
    expect(sanitizeText('hotovo 🙂')).toBe('hotovo ?')
  })

  it('leaves ordinary typography (quotes, dashes, bullets) unchanged', () => {
    expect(sanitizeText('„citace“ – odrážka • konec…')).toBe('„citace“ – odrážka • konec…')
  })
})

describe('characters missing from the font in the rendered PDF', () => {
  it('an arrow in an answer is replaced and does not stay in the PDF as a tofu glyph', async () => {
    const arrowQuestion = makeQuestion({
      type: 'open',
      payload: {
        prompt: 'Popiš cestu vzduchu.',
        lines: 2,
        answer: 'Nos → nosohltan → hrtan.',
      },
    })
    const text = await renderText({
      test: makeTest(),
      template: makeTemplate(),
      items: makeItems([arrowQuestion]),
      variant: 'A',
      withKey: true,
      assets: {},
    })
    expect(text).not.toContain('→')
    expect(text).toContain('Nos -> nosohltan -> hrtan')
  })
})

describe('fill-in hint for matching and ordering', () => {
  it('a matching question has a hint on how to answer', async () => {
    const matching = sampleQuestions.find((q) => q.type === 'matching')!
    const text = await renderText({
      test: makeTest(),
      template: makeTemplate(),
      items: makeItems([matching]),
      variant: 'A',
      withKey: false,
      assets: {},
    })
    expect(text).toContain('Do rámečku napiš písmeno')
  })

  it('an ordering question has a hint on how to answer', async () => {
    const ordering = sampleQuestions.find((q) => q.type === 'ordering')!
    const text = await renderText({
      test: makeTest(),
      template: makeTemplate(),
      items: makeItems([ordering]),
      variant: 'A',
      withKey: false,
      assets: {},
    })
    expect(text).toContain('Do rámečku napiš pořadové číslo')
  })
})

describe('test header', () => {
  it('renders the teacher and the note when filled in', async () => {
    const test = makeTest({
      header: {
        school: 'ZŠ Ukázková',
        subject: 'Přírodopis',
        className: '',
        teacher: 'Mgr. Nováková',
        date: '',
        note: 'Bez kalkulačky',
      },
    })
    const text = await renderText({
      test,
      template: makeTemplate(),
      items: makeItems(sampleQuestions.slice(0, 1)),
      variant: 'A',
      withKey: false,
      assets: {},
    })
    expect(text).toContain('Vyučující: Mgr. Nováková')
    expect(text).toContain('Poznámka: Bez kalkulačky')
  })

  it('renders no empty lines when neither teacher nor note is filled in', async () => {
    const text = await renderText({
      test: makeTest(),
      template: makeTemplate(),
      items: makeItems(sampleQuestions.slice(0, 1)),
      variant: 'A',
      withKey: false,
      assets: {},
    })
    expect(text).not.toContain('Vyučující:')
    expect(text).not.toContain('Poznámka:')
  })
})

describe('question images', () => {
  it('a missing attachment is visibly marked on paper, not silently skipped', async () => {
    const question = makeQuestion({
      type: 'short_answer',
      payload: { prompt: 'Popiš obrázek.', answer: 'x', acceptedAnswers: [] },
      blocks: [{ kind: 'image', assetId: 'missing-asset', widthPercent: 100 }],
    })
    const text = await renderText({
      test: makeTest(),
      template: makeTemplate(),
      items: makeItems([question]),
      variant: 'A',
      withKey: false,
      assets: {}, // asset 'missing-asset' is deliberately missing
    })
    expect(text).toContain('Obrázek se nepodařilo načíst')
  })

  it('a very tall image does not swallow the whole page', async () => {
    const question = makeQuestion({
      type: 'short_answer',
      payload: { prompt: 'Popiš obrázek.', answer: 'x', acceptedAnswers: [] },
      blocks: [{ kind: 'image', assetId: 'tall-1', widthPercent: 100 }],
    })
    const buffer = await render({
      test: makeTest({ graded: false }),
      template: makeTemplate(),
      items: makeItems([question]),
      variant: 'A',
      withKey: false,
      assets: { 'tall-1': TALL_IMAGE_DATA_URL },
    })
    const { pageCount } = await extractPdf(new Uint8Array(buffer))
    // Without a height cap an image with a 1:8 aspect ratio at full column
    // width would come out thousands of points tall (over 5 A4 pages by itself).
    expect(pageCount).toBeLessThanOrEqual(2)
  })
})


describe('answer numbering on paper and in the key', () => {
  async function renderWithKey(question: (typeof sampleQuestions)[number]) {
    return renderText({
      test: makeTest(),
      template: makeTemplate(),
      items: makeItems([question]),
      variant: 'A',
      withKey: true,
      assets: {},
    })
  }

  it('true/false statements are numbered the same as in the key', async () => {
    const question = sampleQuestions.find((q) => q.type === 'true_false')!
    const text = await renderWithKey(question)
    expect(text).toContain('1. Hrtan je tvořen chrupavkami.')
    expect(text).toContain('2. Plíce jsou sval.')
    expect(formatAnswer(question, 'A')).toBe('1. ANO, 2. NE')
    expect(text).toContain('1. ANO, 2. NE')
  })

  it('fill-in blanks are numbered the same as in the key', async () => {
    const question = sampleQuestions.find((q) => q.type === 'fill_blank')!
    const text = await renderWithKey(question)
    expect(text).toContain('(1) ______________')
    expect(text).toContain('(2) ______________')
    expect(formatAnswer(question, 'A')).toBe('(1) dutinou nosní, (2) hrtanu')
    expect(text).toContain('(1) dutinou nosní, (2) hrtanu')
  })

  it('empty cells of a fill-in table are numbered the same as in the key', async () => {
    const question = sampleQuestions.find((q) => q.type === 'table_fill')!
    const text = await renderWithKey(question)
    expect(text).toContain('(1)')
    expect(text).toContain('(2)')
    expect(formatAnswer(question, 'A')).toBe('(1) tvorba hlasu, (2) plicní sklípky')
    expect(text).toContain('(1) tvorba hlasu, (2) plicní sklípky')
  })

  it('numbered marks appear in the question in every built-in template', async () => {
    // Each type separately, so the "(1)" mark cannot come from another question.
    const expected: Record<string, string> = {
      true_false: '1. Hrtan je tvořen chrupavkami.',
      fill_blank: '(1) ______________',
      table_fill: '(1)',
    }
    for (const slug of ['klasicka', 'kompaktni', 'pracovni-list']) {
      for (const [type, marker] of Object.entries(expected)) {
        const question = sampleQuestions.find((q) => q.type === type)!
        const text = await renderText({
          test: makeTest(),
          template: makeTemplate(slug),
          items: makeItems([question]),
          variant: 'A',
          withKey: false,
          assets: {},
        })
        expect(text, `${slug}/${type}`).toContain(marker)
      }
    }
  })
})

describe('ordering does not depend on whether the question stayed in the bank', () => {
  const ordering = sampleQuestions.find((q) => q.type === 'ordering')!
  const snapshot = serializeQuestionSnapshot(ordering)

  it('the order is the same with and without the live question', () => {
    const withLive = resolveTestItemQuestion(snapshot, ordering, 'item-42')
    const withoutLive = resolveTestItemQuestion(snapshot, null, 'item-42')
    // Precondition of the bug: without the live question the test item id is substituted.
    expect(withoutLive.question!.id).not.toBe(withLive.question!.id)
    expect(withoutLive.questionMissing).toBe(true)
    for (const variant of ['A', 'B'] as const) {
      expect(displayOrder(withoutLive.question!, variant)).toEqual(
        displayOrder(withLive.question!, variant),
      )
    }
  })

  it('the order in the question matches the key even after the question is deleted from the bank', async () => {
    const detached = resolveTestItemQuestion(snapshot, null, 'item-42').question!
    if (ordering.type !== 'ordering') throw new Error('typ')
    const text = await renderText({
      test: makeTest(),
      template: makeTemplate(),
      items: makeItems([detached]),
      variant: 'A',
      withKey: true,
      assets: {},
    })

    // Order of the items on paper as rendered by the question component.
    const printed = ordering.payload.items.filter((item) => text.includes(item))
    expect(printed.length).toBe(ordering.payload.items.length)
    const onPaper = [...ordering.payload.items].sort(
      (a, b) => text.indexOf(a) - text.indexOf(b),
    )

    // The key says „n. řádek -> m“: the n-th printed line is the m-th item of the question.
    const key = sanitizeText(formatAnswer(detached, 'A'))
    expect(text).toContain(key)
    key.split(', ').forEach((part, i) => {
      const source = Number(part.split('->')[1]!.trim())
      expect(onPaper[i]).toBe(ordering.payload.items[source - 1])
    })
  })
})

describe('ordering item order', () => {
  it('never comes out in the correct order on paper', () => {
    const words = ['vejce', 'larva', 'kukla', 'dospělec', 'nos', 'hrtan', 'průdušnice', 'průdušky', 'sklípky', 'pravěk', 'starověk', 'středověk']
    for (let n = 3; n <= 5; n += 1) {
      for (let start = 0; start + n <= words.length; start += 1) {
        const question = questionContentSchema.parse({
          type: 'ordering',
          payload: { prompt: 'Seřaď.', items: words.slice(start, start + n) },
        })
        for (const variant of ['A', 'B'] as const) {
          const order = displayOrder(question, variant)
          expect(order.every((sourceIndex, i) => sourceIndex === i), `${n}/${start}/${variant}`).toBe(false)
        }
      }
    }
  })
})
