import { z } from 'zod'
import { blockSchema } from './blocks'

/** Typy otázek podporované aplikací. */
export const QUESTION_TYPES = [
  'open',
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

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  open: 'Volná odpověď',
  short_answer: 'Krátká odpověď',
  single_choice: 'Výběr jedné možnosti',
  multi_choice: 'Výběr více možností',
  true_false: 'Pravda / nepravda',
  fill_blank: 'Doplňování do textu',
  matching: 'Přiřazování dvojic',
  ordering: 'Řazení',
  table_fill: 'Doplňovací tabulka',
  label_image: 'Popis obrázku',
}

/** Typy, které umí generovat AI ve fázi 1 (label_image potřebuje obrázky = fáze 2). */
export const AI_QUESTION_TYPES = QUESTION_TYPES.filter((t) => t !== 'label_image')

/* ------------------------------------------------------------------ payloady */

export const openPayloadSchema = z.object({
  prompt: z.string().min(3),
  /** Počet linek na odpověď. */
  lines: z.number().int().min(1).max(20).default(4),
  answer: z.string().min(1),
})

export const shortAnswerPayloadSchema = z.object({
  prompt: z.string().min(3),
  answer: z.string().min(1),
  /** Další uznávané varianty odpovědi. */
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
  /** Text s místy k doplnění označenými `___` (tři podtržítka). */
  text: z.string().min(5),
  /** Správné výrazy v pořadí výskytu `___`. */
  blanks: z.array(z.string().min(1)).min(1).max(20),
  /** Nabídka slov navíc (volitelná banka výrazů pod zadáním). */
  wordBank: z.array(z.string().min(1)).max(30).default([]),
})

export const matchingPayloadSchema = z.object({
  prompt: z.string().default('Přiřaď k sobě odpovídající dvojice.'),
  left: z.array(z.string().min(1)).min(2).max(12),
  right: z.array(z.string().min(1)).min(2).max(12),
  /** Dvojice [indexVlevo, indexVpravo]. */
  pairs: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])).min(2),
})

export const orderingPayloadSchema = z.object({
  prompt: z.string().min(3),
  /** Položky ve správném pořadí; při vykreslení se zamíchají. */
  items: z.array(z.string().min(1)).min(3).max(12),
})

export const tableFillPayloadSchema = z.object({
  prompt: z.string().min(3),
  /** Hlavičkový řádek tabulky. */
  headers: z.array(z.string()).min(1).max(8),
  /** Řádky; buňka `null` znamená místo k doplnění. */
  rows: z.array(z.array(z.string().nullable()).min(1)).min(1).max(20),
  /** Správné hodnoty pro `null` buňky v pořadí čtení po řádcích. */
  answers: z.array(z.string().min(1)).min(1),
})

export const labelImagePayloadSchema = z.object({
  prompt: z.string().min(3),
  assetId: z.string().min(1),
  /** Popisky očíslovaných míst v obrázku. */
  labels: z.array(z.string().min(1)).min(1).max(20),
})

/* ------------------------------------------------------------------ otázka */

const baseFields = {
  /** Body za otázku; u testu bez známek se nevykreslují. */
  points: z.number().min(0).max(100).default(1),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
  /** Poznámka do klíče (proč je odpověď správně). */
  explanation: z.string().max(1000).optional(),
  blocks: z.array(blockSchema).max(5).default([]),
}

export const questionContentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), payload: openPayloadSchema, ...baseFields }),
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

export const QUESTION_STATUSES = ['draft', 'approved', 'rejected'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]

/** Otázka načtená z databáze — metadata plus obsah (diskriminovaná unie podle `type`). */
export interface QuestionMeta {
  id: string
  topicId: string | null
  materialId: string | null
  source: 'ai' | 'manual'
  status: QuestionStatus
  createdAt: string
}

export type Question = QuestionContent & QuestionMeta

/** Výchozí počet bodů podle typu otázky. */
export const DEFAULT_POINTS: Record<QuestionType, number> = {
  open: 3,
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

/* ------------------------------------------------------------------ validace */

/** Doplňková kontrola, kterou samotné zod schéma neumí (indexy, počty). */
export function validateQuestionContent(q: QuestionContent): string[] {
  const errors: string[] = []
  switch (q.type) {
    case 'single_choice':
      if (q.payload.correctIndex >= q.payload.options.length) {
        errors.push('correctIndex mimo rozsah možností')
      }
      break
    case 'multi_choice': {
      const n = q.payload.options.length
      if (q.payload.correctIndices.some((i) => i >= n)) errors.push('correctIndices mimo rozsah')
      if (new Set(q.payload.correctIndices).size !== q.payload.correctIndices.length) {
        errors.push('correctIndices obsahuje duplicity')
      }
      if (q.payload.correctIndices.length === n) errors.push('všechny možnosti nemohou být správné')
      break
    }
    case 'fill_blank': {
      const placeholders = (q.payload.text.match(/___/g) ?? []).length
      if (placeholders !== q.payload.blanks.length) {
        errors.push(`počet ___ (${placeholders}) neodpovídá počtu blanks (${q.payload.blanks.length})`)
      }
      break
    }
    case 'matching': {
      const { left, right, pairs } = q.payload
      if (pairs.some(([l, r]) => l >= left.length || r >= right.length)) {
        errors.push('pairs odkazují mimo rozsah')
      }
      if (new Set(pairs.map(([l]) => l)).size !== pairs.length) {
        errors.push('levý sloupec se v pairs opakuje')
      }
      break
    }
    case 'ordering':
      if (new Set(q.payload.items).size !== q.payload.items.length) {
        errors.push('items obsahují duplicity')
      }
      break
    case 'table_fill': {
      const cols = q.payload.headers.length
      if (q.payload.rows.some((r) => r.length !== cols)) {
        errors.push('řádky nemají stejný počet sloupců jako hlavička')
      }
      const blanks = q.payload.rows.flat().filter((c) => c === null).length
      if (blanks !== q.payload.answers.length) {
        errors.push(`počet prázdných buněk (${blanks}) neodpovídá počtu answers (${q.payload.answers.length})`)
      }
      break
    }
    default:
      break
  }
  return errors
}
