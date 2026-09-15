import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { describe, expect, it } from 'vitest'
import { TestDocument } from '../src/pdf/TestDocument'
import { registerServerFonts } from '../src/pdf/node'
import { buildVariant, shuffleQuestion } from '../src/pdf/shuffle'
import { formatAnswer } from '../src/pdf/answerKey'
import { sanitizeText } from '../src/pdf/text'
import { extractPdf } from '../src/extract/pdf'
import { makeItems, makeQuestion, makeTemplate, makeTest, sampleQuestions, TALL_IMAGE_DATA_URL } from './fixtures'
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

  it('zaručí jiné pořadí možností, i kdyby náhoda sama o sobě vrátila stejné pořadí', () => {
    // Fisher–Yates s generátorem, který vždy vrátí hodnotu těsně pod 1, si u
    // každého kroku vybere sám sebe — bez záruky by tak zamíchání nic nezměnilo.
    const noopRand = () => 0.999999
    const original = sampleQuestions.find((q) => q.type === 'single_choice')!
    if (original.type !== 'single_choice') throw new Error('typ')
    const result = shuffleQuestion(original, noopRand)
    if (result.type !== 'single_choice') throw new Error('typ')
    expect(result.payload.options).not.toEqual(original.payload.options)
    // Klíč pořád ukazuje na správnou odpověď i po vynuceném přehození.
    expect(result.payload.options[result.payload.correctIndex]).toBe(
      original.payload.options[original.payload.correctIndex],
    )
  })

  it('u dvou možností se pořadí varianty B vždy liší od varianty A', () => {
    // Otázka jen se dvěma možnostmi je nejkritičtější případ: náhodné
    // zamíchání má 50% šanci vrátit totéž pořadí. Zkusíme dost různých ID
    // testu, aby se tahle šance projevila, a ověříme, že se to nikdy nestane.
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

  it('u krátké sekce (dvě otázky) se pořadí vždy liší od varianty A', () => {
    const shortSection = sampleQuestions.slice(0, 2)
    for (let i = 0; i < 200; i += 1) {
      const items = makeItems(shortSection)
      const variantB = buildVariant(items, 'B', `test-${i}`)
      const orderA = items.filter((it) => it.kind === 'question').map((it) => it.questionId)
      const orderB = variantB.filter((it) => it.kind === 'question').map((it) => it.questionId)
      expect(orderB, `test-${i}`).not.toEqual(orderA)
    }
  })

  it('pokyn uprostřed sekce nebrání prohození otázek kolem něj', () => {
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

    // Pokyn zůstává vždy na svém místě v sekvenci...
    for (const testId of ['a', 'b', 'c']) {
      const variantB = buildVariant(items, 'B', testId)
      expect(variantB[2]?.kind, testId).toBe('instruction')
    }

    // ...ale otázka za pokynem se u některé varianty testu dostane před tu,
    // co byla původně před pokynem — kdyby pokyn dělil sekci na dvě části,
    // tohle by se nikdy nestalo.
    const sawSwap = Array.from({ length: 300 }, (_, i) => `test-${i}`).some((testId) => {
      const variantB = buildVariant(items, 'B', testId)
      const order = variantB.filter((it) => it.kind === 'question').map((it) => it.questionId)
      return order[0] === q2.id
    })
    expect(sawSwap).toBe(true)
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

describe('sanitizeText', () => {
  it('nechá běžný český text beze změny', () => {
    expect(sanitizeText('Příliš žluťoučký kůň úpěl ďábelské ódy.')).toBe(
      'Příliš žluťoučký kůň úpěl ďábelské ódy.',
    )
  })

  it('nahradí šipku čitelnou náhradou', () => {
    expect(sanitizeText('nos → nosohltan → hrtan')).toBe('nos -> nosohltan -> hrtan')
  })

  it('nahradí i další znaky mimo font (matematické symboly, fajfky)', () => {
    expect(sanitizeText('a ≠ b')).toBe('a != b')
    expect(sanitizeText('x ≤ 5')).toBe('x <= 5')
    expect(sanitizeText('✓ hotovo')).toBe('[ano] hotovo')
  })

  it('neznámý znak mimo font nahradí čitelným otazníkem, ne pahýlem', () => {
    // Emoji a další znaky mimo naši mapu — obecný fallback, aby se nestalo,
    // že se objeví prázdný/pahýlový glyf, i když jsme na konkrétní znak
    // předem nemysleli.
    expect(sanitizeText('hotovo 🙂')).toBe('hotovo ?')
  })

  it('nechá běžnou typografii (uvozovky, pomlčky, odrážky) beze změny', () => {
    expect(sanitizeText('„citace“ – odrážka • konec…')).toBe('„citace“ – odrážka • konec…')
  })
})

describe('znaky mimo font ve vykresleném PDF', () => {
  it('šipka v odpovědi se nahradí a nezůstane v PDF jako pahýl', async () => {
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

describe('pokyn k vyplnění u přiřazování a řazení', () => {
  it('otázka na přiřazování má pokyn, jak odpovědět', async () => {
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

  it('otázka na řazení má pokyn, jak odpovědět', async () => {
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

describe('hlavička testu', () => {
  it('vykreslí vyučujícího a poznámku, pokud jsou vyplněné', async () => {
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

  it('nevykreslí prázdné řádky, když vyučující ani poznámka nejsou vyplněné', async () => {
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

describe('obrázky u otázky', () => {
  it('chybějící příloha je na papíře viditelně označená, ne tiše přeskočená', async () => {
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
      assets: {}, // asset 'missing-asset' schválně chybí
    })
    expect(text).toContain('Obrázek se nepodařilo načíst')
  })

  it('velmi vysoký obrázek nespolkne celou stránku', async () => {
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
    // Bez stropu výšky by obrázek s poměrem stran 1:8 ve plné šířce sloupce
    // vyšel na tisíce bodů výšky (přes 5 stran A4 sám o sobě).
    expect(pageCount).toBeLessThanOrEqual(2)
  })
})

