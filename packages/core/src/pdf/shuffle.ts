import type { Question, QuestionContent } from '../schema/question'
import type { ResolvedTestItem } from '../schema/test'

/** Deterministický generátor (mulberry32) — varianta B vyjde vždy stejně. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(value: string): number {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j] as T, out[i] as T]
  }
  return out
}

/** Přeháže možnosti uvnitř otázky a přepočítá správné indexy. */
export function shuffleQuestion(question: Question, rand: () => number): Question {
  switch (question.type) {
    case 'single_choice': {
      const order = shuffled(question.payload.options.map((_, i) => i), rand)
      return {
        ...question,
        payload: {
          ...question.payload,
          options: order.map((i) => question.payload.options[i] as string),
          correctIndex: order.indexOf(question.payload.correctIndex),
        },
      }
    }
    case 'multi_choice': {
      const order = shuffled(question.payload.options.map((_, i) => i), rand)
      return {
        ...question,
        payload: {
          ...question.payload,
          options: order.map((i) => question.payload.options[i] as string),
          correctIndices: question.payload.correctIndices
            .map((i) => order.indexOf(i))
            .sort((a, b) => a - b),
        },
      }
    }
    case 'true_false':
      return { ...question, payload: { ...question.payload, statements: shuffled(question.payload.statements, rand) } }
    case 'matching': {
      const order = shuffled(question.payload.right.map((_, i) => i), rand)
      return {
        ...question,
        payload: {
          ...question.payload,
          right: order.map((i) => question.payload.right[i] as string),
          pairs: question.payload.pairs.map(([l, r]) => [l, order.indexOf(r)] as [number, number]),
        },
      }
    }
    default:
      return question
  }
}

/**
 * Varianta B: otázky se přeházejí uvnitř sekcí (mezi nadpisy), takže
 * struktura testu zůstane zachovaná, ale pořadí se liší.
 */
export function buildVariant(items: ResolvedTestItem[], variant: 'A' | 'B', testId: string): ResolvedTestItem[] {
  if (variant === 'A') return items
  const rand = seededRandom(hashSeed(`${testId}:B`))

  const out: ResolvedTestItem[] = []
  let bucket: ResolvedTestItem[] = []
  const flush = () => {
    if (bucket.length > 0) out.push(...shuffled(bucket, rand))
    bucket = []
  }

  for (const item of items) {
    if (item.kind === 'question') bucket.push(item)
    else {
      flush()
      out.push(item)
    }
  }
  flush()

  return out.map((item) =>
    item.kind === 'question' && item.question
      ? { ...item, question: shuffleQuestion(item.question, rand) }
      : item,
  )
}

/** Pořadí položek u otázky typu `ordering` při tisku (zamíchané, deterministicky). */
export function displayOrder(question: QuestionContent & { id?: string }, variant: 'A' | 'B'): number[] {
  if (question.type !== 'ordering') return []
  const rand = seededRandom(hashSeed(`${question.id ?? 'q'}:${variant}`))
  return shuffled(question.payload.items.map((_, i) => i), rand)
}
