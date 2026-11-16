import type { QuestionType } from './question'

/**
 * Forgiving input for the question form: what a teacher types is turned into
 * the stored shape here, so the form does not reject things a person would
 * read the same way (an extra space, an empty row left after „Přidat“, a
 * comma instead of a semicolon).
 */

/**
 * Splits a list typed on one line. A semicolon separates items; without one,
 * a comma does too — except between digits, so „3,5“ stays one number. Once
 * a semicolon appears, commas belong to the items („Praha, Brno; Ostrava“).
 * New lines and tabs (a list or a table row pasted from Word or Excel) always
 * separate. Every keyboard has at least the comma on its first page, phones
 * and tablets included.
 */
export function splitList(text: string, keepEmpty = false): string[] {
  const separator = /[;\n\t]/.test(text) ? /[;\n\t]/ : /(?<!\d),|,(?!\d)/
  const items = text.split(separator).map((item) => item.trim())
  return keepEmpty ? items : items.filter(Boolean)
}

/**
 * A number typed by a person: Czech keyboards (and the numeric pad on them)
 * give a decimal comma, others a dot — both mean the same. Spaces are ignored
 * („1 000“). Returns `null` for anything that is not a number, so the caller
 * can say so instead of silently saving zero.
 */
export function parseDecimal(text: string): number | null {
  const normalized = text.replace(/\s/g, '').replace(',', '.')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(normalized)) return null
  return Number(normalized)
}

/** A number written the Czech way, with a decimal comma. */
export function formatDecimal(value: number): string {
  return String(value).replace('.', ',')
}

type Payload = Record<string, unknown>

const isBlank = (value: unknown) => typeof value === 'string' && value.trim() === ''

/** Trims strings, also inside arrays and plain objects (statements). */
function trimDeep(value: unknown): unknown {
  if (typeof value === 'string') return value.trim()
  if (Array.isArray(value)) return value.map(trimDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, trimDeep(item)]))
  }
  return value
}

/**
 * Drops the items `drop` picks and returns the kept items with a map from old
 * to new index, so indices pointing into the list can follow.
 */
function dropItems<T>(items: T[], drop: (item: T, index: number) => boolean) {
  const kept: T[] = []
  const newIndex = new Map<number, number>()
  items.forEach((item, index) => {
    if (drop(item, index)) return
    newIndex.set(index, kept.length)
    kept.push(item)
  })
  return { kept, newIndex }
}

const remap = (indices: number[], newIndex: Map<number, number>) => indices.map((i) => newIndex.get(i) ?? i)

/**
 * Tidies a payload from the question form before validation: trims texts and
 * removes empty rows (options, statements, items) the teacher added and left
 * blank. A row marked as correct or used in a pair stays even when empty —
 * silently losing the answer would be worse than the error message about it.
 * Works on an unvalidated payload and leaves anything unexpected as it is.
 */
export function tidyPayload(type: QuestionType, payload: Payload): Payload {
  const p = trimDeep(payload) as Payload
  const list = (key: string) => (Array.isArray(p[key]) ? (p[key] as unknown[]) : null)

  switch (type) {
    case 'single_choice': {
      const options = list('options')
      if (!options) return p
      const correct = Number(p.correctIndex)
      const { kept, newIndex } = dropItems(options, (option, i) => isBlank(option) && i !== correct)
      return { ...p, options: kept, correctIndex: newIndex.get(correct) ?? p.correctIndex }
    }
    case 'multi_choice': {
      const options = list('options')
      const correct = Array.isArray(p.correctIndices) ? (p.correctIndices as number[]) : []
      if (!options) return p
      const { kept, newIndex } = dropItems(options, (option, i) => isBlank(option) && !correct.includes(i))
      return { ...p, options: kept, correctIndices: remap(correct, newIndex) }
    }
    case 'true_false': {
      const statements = list('statements')
      if (!statements) return p
      return { ...p, statements: statements.filter((s) => !isBlank((s as { text?: unknown } | null)?.text)) }
    }
    case 'ordering': {
      const items = list('items')
      if (!items) return p
      const order = Array.isArray(p.correctOrder) ? (p.correctOrder as number[]) : null
      const { kept, newIndex } = dropItems(items, (item, i) => isBlank(item) && !order?.includes(i))
      return order ? { ...p, items: kept, correctOrder: remap(order, newIndex) } : { ...p, items: kept }
    }
    case 'matching': {
      const left = list('left')
      const right = list('right')
      const pairs = Array.isArray(p.pairs) ? (p.pairs as [number, number][]) : []
      if (!left || !right) return p
      const l = dropItems(left, (item, i) => isBlank(item) && !pairs.some(([a]) => a === i))
      const r = dropItems(right, (item, i) => isBlank(item) && !pairs.some(([, b]) => b === i))
      return {
        ...p,
        left: l.kept,
        right: r.kept,
        pairs: pairs.map(([a, b]) => [l.newIndex.get(a) ?? a, r.newIndex.get(b) ?? b]),
      }
    }
    default:
      return p
  }
}
