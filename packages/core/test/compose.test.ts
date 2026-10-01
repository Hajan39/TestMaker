import { describe, expect, it } from 'vitest'
import { composeRandomTest, type RandomTestRequest } from '../src/compose/random'
import type { Question, QuestionType } from '../src/schema/question'

/**
 * Random test composition. Questions are built here rather than via
 * `fixtures.ts` because only what the selection reads matters: topic, type,
 * difficulty, status and points.
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

/** Bank: four topics with six questions each, cycling through three types. */
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

const assignment = (over: Partial<RandomTestRequest> = {}): RandomTestRequest => ({
  topicIds: ['t1', 't2', 't3', 't4'],
  limit: { kind: 'count', count: 10 },
  seed: 'seed-1',
  ...over,
})

/** How many questions fell on each topic. */
function byTopic(questions: Question[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const question of questions) counts[question.topicId ?? '—'] = (counts[question.topicId ?? '—'] ?? 0) + 1
  return counts
}

describe('composeRandomTest', () => {
  it('spreads questions across the chosen topics, not ten from one', () => {
    const result = composeRandomTest(bank(), assignment())
    expect(result.questions).toHaveLength(10)

    const counts = byTopic(result.questions)
    expect(Object.keys(counts).sort()).toEqual(['t1', 't2', 't3', 't4'])
    // Ten questions over four topics: two or three each, nothing else.
    for (const count of Object.values(counts)) {
      expect(count).toBeGreaterThanOrEqual(2)
      expect(count).toBeLessThanOrEqual(3)
    }
    // The breakdown report matches what was actually picked.
    for (const share of result.topics) {
      expect(share.picked).toBe(counts[share.topicId ?? '—'] ?? 0)
      expect(share.available).toBe(6)
    }
    expect(result.shortfall).toBe(0)
    expect(result.notes).toEqual([])
  })

  it('spreads questions across types too', () => {
    const result = composeRandomTest(bank(), assignment({ limit: { kind: 'count', count: 9 } }))
    const types = new Map<string, number>()
    for (const question of result.questions) types.set(question.type, (types.get(question.type) ?? 0) + 1)
    expect([...types.keys()].sort()).toEqual(['open', 'short_answer', 'single_choice'])
    // Nine questions, three types — three of each.
    for (const count of types.values()) expect(count).toBe(3)
  })

  it('takes only allowed types and only the chosen difficulty', () => {
    const result = composeRandomTest(
      bank(),
      assignment({ types: ['open'], difficulty: 2, limit: { kind: 'count', count: 8 } }),
    )
    expect(result.questions.length).toBeGreaterThan(0)
    for (const question of result.questions) {
      expect(question.type).toBe('open')
      expect(question.difficulty).toBe(2)
    }
  })

  it('draws only from the ticked topics', () => {
    const result = composeRandomTest(bank(), assignment({ topicIds: ['t2', 't3'] }))
    expect(new Set(result.questions.map((question) => question.topicId))).toEqual(new Set(['t2', 't3']))
  })

  it('without "approved only" takes drafts too, with it ticked it does not', () => {
    const questions = [
      q('a1', 't1', 'open'),
      q('a2', 't1', 'open', { status: 'draft' }),
      q('a3', 't1', 'open', { status: 'rejected' }),
    ]
    const all = composeRandomTest(questions, assignment({ topicIds: ['t1'], limit: { kind: 'count', count: 3 } }))
    expect(all.questions).toHaveLength(3)

    const approvedOnly = composeRandomTest(
      questions,
      assignment({ topicIds: ['t1'], limit: { kind: 'count', count: 3 }, onlyApproved: true }),
    )
    expect(approvedOnly.questions.map((question) => question.id)).toEqual(['a1'])
    expect(approvedOnly.shortfall).toBe(2)
  })

  it('when there are not enough questions, inserts what there is and says so', () => {
    const result = composeRandomTest(bank(), assignment({ limit: { kind: 'count', count: 40 } }))
    expect(result.questions).toHaveLength(24)
    expect(result.shortfall).toBe(16)
    expect(result.notes.join(' ')).toContain('jen 24 z požadovaných 40')
  })

  it('reports a topic without any matching question separately', () => {
    const questions = [...bank(), ...[]]
    const result = composeRandomTest(questions, assignment({ topicIds: ['t1', 'prazdne'] }))
    expect(result.topics.find((topic) => topic.topicId === 'prazdne')).toEqual({
      topicId: 'prazdne',
      picked: 0,
      available: 0,
    })
    expect(result.notes.join(' ')).toContain('Jedno vybrané téma')
  })

  it('with no matching question at all returns nothing and gives advice', () => {
    const result = composeRandomTest(bank(), assignment({ types: ['matching'] }))
    expect(result.questions).toEqual([])
    expect(result.notes.join(' ')).toContain('Filtrům nevyhovuje ani jedna otázka')
  })

  it('can follow a total point count', () => {
    const result = composeRandomTest(bank(), assignment({ limit: { kind: 'points', points: 12 } }))
    expect(result.totalPoints).toBe(12)
    expect(result.shortfall).toBe(0)
    expect(result.questions.reduce((sum, question) => sum + question.points, 0)).toBe(12)
  })

  it('does not overshoot the points target when it can be hit', () => {
    // One five-point question and plenty of one-pointers: a 4-point target must be hit exactly.
    const questions = [
      q('velka', 't1', 'open', { points: 5 }),
      ...Array.from({ length: 6 }, (_, i) => q(`mala-${i}`, 't1', 'short_answer', { points: 1 })),
    ]
    const result = composeRandomTest(questions, assignment({ topicIds: ['t1'], limit: { kind: 'points', points: 4 } }))
    expect(result.totalPoints).toBe(4)
    expect(result.questions.map((question) => question.id)).not.toContain('velka')
  })

  it('the same seed gives the same selection and order', () => {
    const a = composeRandomTest(bank(), assignment({ seed: 'pisemka-1' }))
    const b = composeRandomTest(bank(), assignment({ seed: 'pisemka-1' }))
    expect(a.questions.map((question) => question.id)).toEqual(b.questions.map((question) => question.id))
  })

  it('does not depend on the order questions come from the database', () => {
    const a = composeRandomTest(bank(), assignment({ seed: 'pisemka-1' }))
    const b = composeRandomTest([...bank()].reverse(), assignment({ seed: 'pisemka-1' }))
    expect(a.questions.map((question) => question.id)).toEqual(b.questions.map((question) => question.id))
  })

  it('a different seed gives a different selection or order', () => {
    const a = composeRandomTest(bank(), assignment({ seed: 'pisemka-1' }))
    const b = composeRandomTest(bank(), assignment({ seed: 'pisemka-2' }))
    expect(a.questions.map((question) => question.id)).not.toEqual(b.questions.map((question) => question.id))
  })

  it('the same question is never picked twice', () => {
    const result = composeRandomTest(bank(), assignment({ limit: { kind: 'count', count: 24 } }))
    expect(new Set(result.questions.map((question) => question.id)).size).toBe(24)
  })
})
