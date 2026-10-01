import { z } from 'zod'
import { t } from '../i18n'
import { blockSchema } from './blocks'

/** Question types supported by the app. */
export const QUESTION_TYPES = [
  'open',
  'draw',
  'short_answer',
  'single_choice',
  'multi_choice',
  'true_false',
  'fill_blank',
  'matching',
  'ordering',
  'table_fill',
  'label_image',
] as const

export type QuestionType = (typeof QUESTION_TYPES)[number]

/** Name of the question type shown to the teacher (and used in model prompts). */
export function questionTypeLabel(type: QuestionType): string {
  return t(`core:questionTypes.${type}`)
}

/**
 * Types the AI generates in the app. Matching, ordering and fill-in-the-blank
 * were added when generation moved to Gemini — it gets indices and counts
 * right reliably. Multiple choice and open answers were added by the owner's
 * decision of 27 Sep 2026: `validateQuestionContent` checks the same things
 * for them as for the others (index out of range, repeated option…), so a
 * model failure only drops the question instead of letting it into the bank
 * broken. Tables and image labelling stay for manual authoring and for
 * questions from Claude Code (`/otazky`) — the model mixes up columns and rows
 * in tables, and image labelling also needs an image, which phase 1 does not
 * generate.
 */
export const AI_QUESTION_TYPES = [
  'single_choice',
  'true_false',
  'short_answer',
  'matching',
  'ordering',
  'fill_blank',
  'multi_choice',
  'open',
] as const satisfies readonly QuestionType[]

export type AiQuestionType = (typeof AI_QUESTION_TYPES)[number]

/* ------------------------------------------------------------------ payloads */

export const openPayloadSchema = z.object({
  prompt: z.string().min(3),
  /** Number of answer lines. */
  lines: z.number().int().min(1).max(20).default(4),
  answer: z.string().min(1),
})

/**
 * Draw and describe — like an open answer, but blank space for a drawing is
 * printed instead of lines. The height of the space is given in lines
 * (`lines` × line height from the template), so it can be overridden in the
 * test with the same `linesOverride` as for `open`.
 */
export const drawPayloadSchema = z.object({
  prompt: z.string().min(3),
  /** Height of the blank space in lines. */
  lines: z.number().int().min(1).max(30).default(8),
  /** What the drawing should contain and how to label it — for the answer key. */
  answer: z.string().min(1),
})

export const shortAnswerPayloadSchema = z.object({
  prompt: z.string().min(3),
  answer: z.string().min(1),
  /** Other accepted answer variants. */
  acceptedAnswers: z.array(z.string().min(1)).max(10).default([]),
})

export const singleChoicePayloadSchema = z.object({
  prompt: z.string().min(3),
  options: z.array(z.string().min(1)).min(2).max(8),
  correctIndex: z.number().int().min(0),
})

export const multiChoicePayloadSchema = z.object({
  prompt: z.string().min(3),
  options: z.array(z.string().min(1)).min(3).max(10),
  correctIndices: z.array(z.number().int().min(0)).min(1),
})

export const trueFalsePayloadSchema = z.object({
  prompt: z.string().default('Rozhodni, zda jsou tvrzení pravdivá.'),
  statements: z
    .array(z.object({ text: z.string().min(3), isTrue: z.boolean() }))
    .min(1)
    .max(12),
})

export const fillBlankPayloadSchema = z.object({
  prompt: z.string().default('Doplň chybějící výrazy.'),
  /** Text with blanks marked by `___` (three underscores). */
  text: z.string().min(5),
  /** Correct expressions in order of the `___` occurrences. */
  blanks: z.array(z.string().min(1)).min(1).max(20),
  /** Extra words on offer (optional word bank below the prompt). */
  wordBank: z.array(z.string().min(1)).max(30).default([]),
})

export const matchingPayloadSchema = z.object({
  prompt: z.string().default('Přiřaď k sobě odpovídající dvojice.'),
  left: z.array(z.string().min(1)).min(2).max(12),
  right: z.array(z.string().min(1)).min(2).max(12),
  /**
   * Pairs [leftIndex, rightIndex]. Deliberately a two-element array, not
   * `z.tuple` — a tuple produces a JSON schema with `items` as an array of
   * schemas and Google Gemini rejects such a schema ("items must be a boolean
   * or an object"). The length is enforced by `.length(2)`.
   */
  pairs: z
    .array(
      z
        .array(z.number().int().min(0))
        .length(2)
        .transform((pair) => pair as [number, number]),
    )
    .min(2),
})

export const orderingPayloadSchema = z.object({
  prompt: z.string().min(3),
  /**
   * Items. For older data (without `correctOrder`) and for rendering (PDF,
   * answer key) they are already in the correct order — only printing
   * shuffles them.
   */
  items: z.array(z.string().min(1)).min(3).max(12),
  /**
   * Optional: indices into `items` giving the actual correct order. The model
   * often confuses "list the items" with "list them in the correct order",
   * and without a separate field that cannot be detected or fixed. When set,
   * `normalizeOrderingPayload` reorders `items` by it and drops the field
   * before saving — the shape of stored data and the PDF stay unchanged.
   */
  correctOrder: z.array(z.number().int().min(0)).min(3).max(12).optional(),
})

export const tableFillPayloadSchema = z.object({
  prompt: z.string().min(3),
  /** Header row of the table. */
  headers: z.array(z.string()).min(1).max(8),
  /** Rows; a `null` cell is a blank to fill in. */
  rows: z.array(z.array(z.string().nullable()).min(1)).min(1).max(20),
  /** Correct values for the `null` cells in row-by-row reading order. */
  answers: z.array(z.string().min(1)).min(1),
})

export const labelImagePayloadSchema = z.object({
  prompt: z.string().min(3),
  assetId: z.string().min(1),
  /** Labels of the numbered spots in the image. */
  labels: z.array(z.string().min(1)).min(1).max(20),
})

/* ------------------------------------------------------------------ question */

const baseFields = {
  /** Points for the question; not rendered for ungraded tests. */
  points: z.number().min(0).max(100).default(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  /** Note for the answer key (why the answer is correct). */
  explanation: z.string().max(1000).optional(),
  blocks: z.array(blockSchema).max(5).default([]),
  /** Evidence of origin: the file and passage the question relies on. */
  evidence: z
    .object({
      fileName: z.string().min(1),
      /* Length is not limited — validating the whole object would fail the
       * entire batch because of a single question. Trimming and an empty
       * quote are handled on save. */
      quote: z.string(),
    })
    .optional(),
}

export const questionContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), payload: openPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('draw'), payload: drawPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('short_answer'), payload: shortAnswerPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('single_choice'), payload: singleChoicePayloadSchema, ...baseFields }),
  z.object({ type: z.literal('multi_choice'), payload: multiChoicePayloadSchema, ...baseFields }),
  z.object({ type: z.literal('true_false'), payload: trueFalsePayloadSchema, ...baseFields }),
  z.object({ type: z.literal('fill_blank'), payload: fillBlankPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('matching'), payload: matchingPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('ordering'), payload: orderingPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('table_fill'), payload: tableFillPayloadSchema, ...baseFields }),
  z.object({ type: z.literal('label_image'), payload: labelImagePayloadSchema, ...baseFields }),
])

export type QuestionContent = z.infer<typeof questionContentSchema>

/** Longest quote stored as evidence of origin — longer ones are trimmed. */
export const MAX_EVIDENCE_QUOTE_LENGTH = 400

/**
 * Reorders the `items` of an ordering question by `correctOrder` if the model
 * filled it in, and removes `correctOrder` from the result. Called before
 * saving, so the PDF and the answer key (which take the order straight from
 * `items`) need not know about the new field at all.
 */
export function normalizeOrderingPayload(q: QuestionContent): QuestionContent {
  if (q.type !== 'ordering') return q
  const { correctOrder, ...rest } = q.payload
  if (!correctOrder) return q
  // validateQuestionContent checks that correctOrder is a permutation of the
  // item indices before we ever get here — this is only the reordering.
  return { ...q, payload: { ...rest, items: correctOrder.map((i) => rest.items[i] as string) } }
}

/**
 * When the model returns matching with the right column in the same order as
 * the left one (pairs `[0,0], [1,1], …`), it could be solved on paper without
 * reading — just connect each row with the one opposite. This function
 * detects that case and deterministically shifts the right column by one
 * position (cyclically), so no item stays in its original place while the
 * pairs still point to the same factual pairs. It is not random — the same
 * input must always give the same output, otherwise tests and manual checks
 * would disagree.
 */
export function normalizeMatchingPayload(q: QuestionContent): QuestionContent {
  if (q.type !== 'matching') return q
  const { left, right, pairs } = q.payload
  const n = left.length
  const isIdentity = right.length === n && pairs.length === n && pairs.every(([l, r]) => l === r)
  if (!isIdentity) return q
  const newRight = Array.from({ length: n }, (_, i) => right[(i + 1) % n] as string)
  const newPairs: [number, number][] = Array.from({ length: n }, (_, l) => [l, (l - 1 + n) % n])
  return { ...q, payload: { ...q.payload, right: newRight, pairs: newPairs } }
}

/**
 * Evidence of origin from the model's answer in storable form. The schema
 * does not check the quote length (one quote that is too long or too short
 * would otherwise fail the whole generation batch) — it is handled here, on
 * save: an empty or whitespace-only quote means missing evidence, a too long
 * one is trimmed.
 */
export function normalizeEvidence(
  evidence: QuestionContent['evidence'],
): { fileName: string; quote: string } | null {
  if (!evidence) return null
  const quote = evidence.quote.trim()
  if (!quote) return null
  return {
    fileName: evidence.fileName,
    quote:
      quote.length > MAX_EVIDENCE_QUOTE_LENGTH
        ? `${quote.slice(0, MAX_EVIDENCE_QUOTE_LENGTH).trim()}…`
        : quote,
  }
}

/**
 * Reasons why the teacher regenerates a question. Each gives the model a
 * clear hint in the prompt (`hint`) and possibly shifts the difficulty of the
 * replacement (`shift`) — "too hard"/"too easy" are the only two reasons that
 * move difficulty, the others keep it unchanged.
 *
 * `rule` is a different sentence than `hint`: `hint` talks about *this*
 * replacement ("Předchozí verze…"), whereas `rule` is a general, timeless
 * rule for *every* further generation — it prefills the prompt rule editor in
 * Management (`ManagementScreen`, "Udělat z toho pravidlo") when the admin
 * turns a frequent regeneration reason into a permanent school rule.
 *
 * `hint` and `rule` are model prompt texts; `label` is shown in the UI and is
 * a getter so it is translated at the moment of use.
 */
export const REGENERATE_REASONS = {
  nesmysl: {
    get label() {
      return t('core:regenerateReasons.nesmysl')
    },
    hint: 'Předchozí verze nedávala smysl — zadání musí být jasné a jednoznačné.',
    rule: 'Zadání musí být jasné a jednoznačné.',
    shift: 0,
  },
  moznosti: {
    get label() {
      return t('core:regenerateReasons.moznosti')
    },
    hint: 'Předchozí verze měla špatné možnosti — právě jedna musí být správná a ostatní věrohodně špatné.',
    rule: 'Právě jedna možnost je správná, ostatní jsou věrohodně špatné.',
    shift: 0,
  },
  mimo: {
    get label() {
      return t('core:regenerateReasons.mimo')
    },
    hint: 'Předchozí verze se ptala na něco, co v materiálu není — drž se doslova textu.',
    rule: 'Ptej se jen na to, co v materiálu doslova stojí.',
    shift: 0,
  },
  tezka: {
    get label() {
      return t('core:regenerateReasons.tezka')
    },
    hint: 'Předchozí verze byla na ročník moc těžká.',
    rule: 'Otázky drž spíš na spodní hranici náročnosti ročníku.',
    shift: -1,
  },
  lehka: {
    get label() {
      return t('core:regenerateReasons.lehka')
    },
    hint: 'Předchozí verze byla moc lehká.',
    rule: 'Otázky drž spíš na horní hranici náročnosti ročníku.',
    shift: 1,
  },
  cestina: {
    get label() {
      return t('core:regenerateReasons.cestina')
    },
    hint: 'Předchozí verze měla chyby v češtině — piš spisovně a jednoduše.',
    rule: 'Piš spisovnou a jednoduchou češtinou bez chyb.',
    shift: 0,
  },
  odkaz: {
    get label() {
      return t('core:regenerateReasons.odkaz')
    },
    hint: 'Předchozí verze odkazovala na materiál — otázka musí stát sama, bez zmínky o textu nebo zdroji.',
    rule: 'Otázka nikdy neodkazuje na materiál, text ani zdroj; stojí sama.',
    shift: 0,
  },
} as const

export type RegenerateReason = keyof typeof REGENERATE_REASONS

export const QUESTION_STATUSES = ['draft', 'approved', 'rejected'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

/** Question loaded from the database — metadata plus content (discriminated union by `type`). */
export interface QuestionMeta {
  id: string
  topicId: string | null
  materialId: string | null
  source: 'ai' | 'manual'
  status: QuestionStatus
  createdAt: string
  /**
   * Root question this one was created from as an easier or harder version.
   * `null` for the root question itself. A version of a version always links
   * to the root, not to its immediate predecessor — otherwise versions would
   * form a chain and the question card could not show all versions together.
   */
  variantOf: string | null
}

export type Question = QuestionContent & QuestionMeta

/** Default points by question type. */
export const DEFAULT_POINTS: Record<QuestionType, number> = {
  open: 3,
  draw: 3,
  short_answer: 1,
  single_choice: 1,
  multi_choice: 2,
  true_false: 2,
  fill_blank: 2,
  matching: 3,
  ordering: 2,
  table_fill: 3,
  label_image: 3,
}

/**
 * Points by the scope of the answer, as the teacher gives them: a point per
 * blank, pair or label, a point for a one-word answer and single choice, two
 * points for multiple choice. The model only guesses points (it offered even
 * 10 points for a short matching), so its number is not taken for these
 * types. Open answers and drawings have nothing to count — the scope of the
 * answer decides there, which only the model or the teacher can judge, and
 * the function returns `null`.
 */
export function pointsByScope(q: QuestionContent): number | null {
  switch (q.type) {
    case 'short_answer':
    case 'single_choice':
      return 1
    case 'multi_choice':
      return 2
    case 'fill_blank':
      return q.payload.blanks.length
    case 'matching':
      return q.payload.pairs.length
    case 'table_fill':
      return q.payload.answers.length
    case 'label_image':
      return q.payload.labels.length
    case 'true_false':
    case 'ordering':
      return DEFAULT_POINTS[q.type]
    case 'open':
    case 'draw':
      return null
  }
}

/* ------------------------------------------------------------------ validation */

/** Additional checks the zod schema alone cannot do (indices, counts). */
export function validateQuestionContent(q: QuestionContent): string[] {
  const errors: string[] = []
  switch (q.type) {
    case 'single_choice':
      if (q.payload.correctIndex >= q.payload.options.length) {
        errors.push(t('core:validation.correctIndexOutOfRange'))
      }
      break
    case 'multi_choice': {
      const n = q.payload.options.length
      if (q.payload.correctIndices.some((i) => i >= n)) errors.push(t('core:validation.correctIndicesOutOfRange'))
      if (new Set(q.payload.correctIndices).size !== q.payload.correctIndices.length) {
        errors.push(t('core:validation.correctIndicesDuplicate'))
      }
      // One, several or all may be correct — the pupil must not guess from the
      // shape of the question how many to mark.
      const normalizedOptions = q.payload.options.map((o) => o.trim().toLowerCase())
      if (new Set(normalizedOptions).size !== normalizedOptions.length) {
        errors.push(t('core:validation.optionsRepeat'))
      }
      break
    }
    case 'fill_blank': {
      const placeholders = (q.payload.text.match(/___/g) ?? []).length
      if (placeholders !== q.payload.blanks.length) {
        errors.push(t('core:validation.blanksMismatch', { placeholders, blanks: q.payload.blanks.length }))
      }
      break
    }
    case 'matching': {
      const { left, right, pairs } = q.payload
      if (pairs.some(([l, r]) => l >= left.length || r >= right.length)) {
        errors.push(t('core:validation.pairsOutOfRange'))
      }
      if (new Set(pairs.map(([l]) => l)).size !== pairs.length) {
        errors.push(t('core:validation.leftRepeats'))
      }
      if (new Set(pairs.map(([, r]) => r)).size !== pairs.length) {
        errors.push(t('core:validation.rightRepeats'))
      }
      // Every item on the left needs a pair — otherwise a row remains on paper
      // that cannot be matched to anything. Extra items on the right
      // (distractors) are allowed, they are simply not part of pairs.
      if (pairs.length !== left.length) {
        errors.push(t('core:validation.leftUnpaired'))
      }
      break
    }
    case 'ordering': {
      const { items, correctOrder } = q.payload
      if (new Set(items).size !== items.length) {
        errors.push(t('core:validation.itemsDuplicate'))
      }
      if (correctOrder) {
        const inRange = correctOrder.every((i) => i >= 0 && i < items.length)
        const isPermutation = correctOrder.length === items.length && new Set(correctOrder).size === items.length
        if (!inRange || !isPermutation) {
          errors.push(t('core:validation.correctOrderInvalid'))
        }
      }
      break
    }
    case 'table_fill': {
      const cols = q.payload.headers.length
      if (q.payload.rows.some((r) => r.length !== cols)) {
        errors.push(t('core:validation.rowsColumnMismatch'))
      }
      const blanks = q.payload.rows.flat().filter((c) => c === null).length
      if (blanks !== q.payload.answers.length) {
        errors.push(t('core:validation.blankCellsMismatch', { blanks, answers: q.payload.answers.length }))
      }
      break
    }
    default:
      break
  }

  // Weaker models like to return a choice hidden in the prompt text and mark
  // the type as a short answer. The paper then shows "a) … b) … c) …" with an
  // answer line below, although it should have been a choice. Such a question
  // must not get into the bank — it is a broken prompt, not just another form.
  if (TYPES_WITHOUT_INLINE_OPTIONS.has(q.type)) {
    const prompt = (q.payload as { prompt?: unknown }).prompt
    if (typeof prompt === 'string' && countInlineOptions(prompt) >= 3) {
      errors.push(t('core:validation.inlineOptions'))
    }
  }

  return errors
}

/** Types whose options are listed separately, so they have no place in the prompt. */
const TYPES_WITHOUT_INLINE_OPTIONS = new Set<QuestionType>([
  'open',
  'draw',
  'short_answer',
  'true_false',
  'fill_blank',
])

/**
 * How many markers like "a)", "B)" or "3)" start an enumeration in the text.
 * Only after a space or at the start of a line, so abbreviations inside a
 * sentence are not caught ("odpověď a) platí" yes, "např) " no).
 */
function countInlineOptions(text: string): number {
  const matches = text.match(/(^|[\s(])[a-eA-E1-5][).]\s/g)
  return matches?.length ?? 0
}
