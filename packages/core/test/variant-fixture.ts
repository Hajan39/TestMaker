import type { ResolvedTestItem } from '../src/schema/test'
import { sampleQuestions } from './fixtures'

/**
 * Two sections (split by a page break) with an instruction in the middle of the
 * first one — every rule of variant B applies to it.
 */
export function fixtureItems(): ResolvedTestItem[] {
  const base = { testId: 'test-1', text: null, pointsOverride: null, questionId: null }
  const question = (index: number): ResolvedTestItem => ({
    ...base,
    id: `q${index}`,
    order: 0,
    kind: 'question',
    questionId: `bank-${index}`,
    question: sampleQuestions[index % sampleQuestions.length]!,
  })
  const items: ResolvedTestItem[] = [
    { ...base, id: 'h1', order: 0, kind: 'heading', text: 'Část A' },
    question(0),
    question(1),
    { ...base, id: 'i1', order: 0, kind: 'instruction', text: 'Pokyn' },
    question(2),
    question(3),
    { ...base, id: 'pb', order: 0, kind: 'page_break' },
    question(4),
    question(5),
    question(6),
  ]
  return items.map((item, order) => ({ ...item, order }))
}

/** Item order plus the printed option order of each question — everything variant B changes. */
export function signature(items: ResolvedTestItem[]): { ids: string[]; options: Record<string, unknown> } {
  const options: Record<string, unknown> = {}
  for (const item of items) {
    const payload = item.question?.payload as Record<string, unknown> | undefined
    if (!payload) continue
    options[item.id] = payload.options ?? payload.statements ?? payload.right ?? null
  }
  return { ids: items.map((item) => item.id), options }
}
