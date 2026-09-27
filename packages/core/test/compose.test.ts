import { describe, expect, it } from 'vitest'
import { composeRandomTest, type RandomTestRequest } from '../src/compose/random'
import type { Question, QuestionType } from '../src/schema/question'

/**
 * Náhodné sestavení písemky. Otázky se vyrábějí tady a ne přes `fixtures.ts`,
 * protože rozhoduje jen to, co výběr čte: téma, typ, obtížnost, stav a body.
 */
function q(
  id: string,
  topicId: string,
  type: QuestionType,
  extra: { difficulty?: 1 | 2 | 3; status?: Question['status']; points?: number } = {},
): Question {
  const payload =
    type === 'open'
      ? { prompt: `${id} zadání`, lines: 4, answer: 'odpověď' }
      : type === 'short_answer'
        ? { prompt: `${id} zadání`, answer: 'odpověď', acceptedAnswers: [] }
        : { prompt: `${id} zadání`, options: ['a', 'b', 'c'], correctIndex: 0 }
  return {
    id,
    topicId,
    materialId: null,
    variantOf: null,
    source: 'ai',
    status: extra.status ?? 'approved',
    createdAt: '2026-01-01T00:00:00.000Z',
    points: extra.points ?? 1,
    difficulty: extra.difficulty ?? 2,
    blocks: [],
    type,
    payload,
  } as Question
}

/** Banka: čtyři témata po šesti otázkách, střídají se tři typy. */
function bank(): Question[] {
  const types: QuestionType[] = ['single_choice', 'open', 'short_answer']
  return ['t1', 't2', 't3', 't4'].flatMap((topic) =>
    Array.from({ length: 6 }, (_, i) =>
      q(`${topic}-q${i}`, topic, types[i % 3] as QuestionType, {
        difficulty: ((i % 3) + 1) as 1 | 2 | 3,
        points: (i % 3) + 1,
      }),
    ),
  )
}

const zadani = (over: Partial<RandomTestRequest> = {}): RandomTestRequest => ({
  topicIds: ['t1', 't2', 't3', 't4'],
  limit: { kind: 'count', count: 10 },
  seed: 'seed-1',
  ...over,
})

/** Kolik otázek připadlo na které téma. */
function podleTemat(questions: Question[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const question of questions) counts[question.topicId ?? '—'] = (counts[question.topicId ?? '—'] ?? 0) + 1
  return counts
}

describe('composeRandomTest', () => {
  it('rozprostře otázky mezi vybraná témata, ne deset z jednoho', () => {
    const result = composeRandomTest(bank(), zadani())
    expect(result.questions).toHaveLength(10)

    const counts = podleTemat(result.questions)
    expect(Object.keys(counts).sort()).toEqual(['t1', 't2', 't3', 't4'])
    // Deset otázek na čtyři témata: dvě nebo tři na každé, nic jiného.
    for (const count of Object.values(counts)) {
      expect(count).toBeGreaterThanOrEqual(2)
      expect(count).toBeLessThanOrEqual(3)
    }
    // Hlášení o rozdělení odpovídá tomu, co opravdu vyšlo.
    for (const share of result.topics) {
      expect(share.picked).toBe(counts[share.topicId ?? '—'] ?? 0)
      expect(share.available).toBe(6)
    }
    expect(result.shortfall).toBe(0)
    expect(result.notes).toEqual([])
  })

  it('rozprostře otázky i mezi typy', () => {
    const result = composeRandomTest(bank(), zadani({ limit: { kind: 'count', count: 9 } }))
    const types = new Map<string, number>()
    for (const question of result.questions) types.set(question.type, (types.get(question.type) ?? 0) + 1)
    expect([...types.keys()].sort()).toEqual(['open', 'short_answer', 'single_choice'])
    // Devět otázek, tři typy — po třech od každého.
    for (const count of types.values()) expect(count).toBe(3)
  })

  it('bere jen povolené typy a jen zvolenou obtížnost', () => {
    const result = composeRandomTest(
      bank(),
      zadani({ types: ['open'], difficulty: 2, limit: { kind: 'count', count: 8 } }),
    )
    expect(result.questions.length).toBeGreaterThan(0)
    for (const question of result.questions) {
      expect(question.type).toBe('open')
      expect(question.difficulty).toBe(2)
    }
  })

  it('losuje jen ze zaškrtnutých témat', () => {
    const result = composeRandomTest(bank(), zadani({ topicIds: ['t2', 't3'] }))
    expect(new Set(result.questions.map((question) => question.topicId))).toEqual(new Set(['t2', 't3']))
  })

  it('bez „jen schválené“ bere i koncepty, se zaškrtnutím ne', () => {
    const questions = [
      q('a1', 't1', 'open'),
      q('a2', 't1', 'open', { status: 'draft' }),
      q('a3', 't1', 'open', { status: 'rejected' }),
    ]
    const vse = composeRandomTest(questions, zadani({ topicIds: ['t1'], limit: { kind: 'count', count: 3 } }))
    expect(vse.questions).toHaveLength(3)

    const jenSchvalene = composeRandomTest(
      questions,
      zadani({ topicIds: ['t1'], limit: { kind: 'count', count: 3 }, onlyApproved: true }),
    )
    expect(jenSchvalene.questions.map((question) => question.id)).toEqual(['a1'])
    expect(jenSchvalene.shortfall).toBe(2)
  })

  it('když otázek není dost, vloží co je a řekne to', () => {
    const result = composeRandomTest(bank(), zadani({ limit: { kind: 'count', count: 40 } }))
    expect(result.questions).toHaveLength(24)
    expect(result.shortfall).toBe(16)
    expect(result.notes.join(' ')).toContain('jen 24 z požadovaných 40')
  })

  it('u tématu bez vyhovující otázky to řekne zvlášť', () => {
    const questions = [...bank(), ...[]]
    const result = composeRandomTest(questions, zadani({ topicIds: ['t1', 'prazdne'] }))
    expect(result.topics.find((topic) => topic.topicId === 'prazdne')).toEqual({
      topicId: 'prazdne',
      picked: 0,
      available: 0,
    })
    expect(result.notes.join(' ')).toContain('Jedno vybrané téma')
  })

  it('bez jediné vyhovující otázky vrátí prázdno a poradí', () => {
    const result = composeRandomTest(bank(), zadani({ types: ['matching'] }))
    expect(result.questions).toEqual([])
    expect(result.notes.join(' ')).toContain('Filtrům nevyhovuje ani jedna otázka')
  })

  it('umí se řídit celkovým počtem bodů', () => {
    const result = composeRandomTest(bank(), zadani({ limit: { kind: 'points', points: 12 } }))
    expect(result.totalPoints).toBe(12)
    expect(result.shortfall).toBe(0)
    expect(result.questions.reduce((sum, question) => sum + question.points, 0)).toBe(12)
  })

  it('u bodů nepřestřelí cíl, když se trefit dá', () => {
    // Jedna otázka za pět bodů a dost jednobodových: cíl 4 b. musí vyjít přesně.
    const questions = [
      q('velka', 't1', 'open', { points: 5 }),
      ...Array.from({ length: 6 }, (_, i) => q(`mala-${i}`, 't1', 'short_answer', { points: 1 })),
    ]
    const result = composeRandomTest(questions, zadani({ topicIds: ['t1'], limit: { kind: 'points', points: 4 } }))
    expect(result.totalPoints).toBe(4)
    expect(result.questions.map((question) => question.id)).not.toContain('velka')
  })

  it('stejný seed dá stejný výběr i pořadí', () => {
    const a = composeRandomTest(bank(), zadani({ seed: 'pisemka-1' }))
    const b = composeRandomTest(bank(), zadani({ seed: 'pisemka-1' }))
    expect(a.questions.map((question) => question.id)).toEqual(b.questions.map((question) => question.id))
  })

  it('nezáleží na pořadí, ve kterém otázky přijdou z databáze', () => {
    const a = composeRandomTest(bank(), zadani({ seed: 'pisemka-1' }))
    const b = composeRandomTest([...bank()].reverse(), zadani({ seed: 'pisemka-1' }))
    expect(a.questions.map((question) => question.id)).toEqual(b.questions.map((question) => question.id))
  })

  it('jiný seed dá jiný výběr nebo jiné pořadí', () => {
    const a = composeRandomTest(bank(), zadani({ seed: 'pisemka-1' }))
    const b = composeRandomTest(bank(), zadani({ seed: 'pisemka-2' }))
    expect(a.questions.map((question) => question.id)).not.toEqual(b.questions.map((question) => question.id))
  })

  it('táž otázka se ve výběru neopakuje', () => {
    const result = composeRandomTest(bank(), zadani({ limit: { kind: 'count', count: 24 } }))
    expect(new Set(result.questions.map((question) => question.id)).size).toBe(24)
  })
})
