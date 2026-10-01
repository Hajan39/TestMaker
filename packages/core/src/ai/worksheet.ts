import { z } from 'zod'
import { t } from '../i18n'
import {
  normalizeMatchingPayload,
  normalizeOrderingPayload,
  questionContentSchema,
  validateQuestionContent,
  type QuestionContent,
} from '../schema/question'
import {
  TEXT_ITEM_VARIANTS,
  tableItemContentSchema,
  tableItemShapeSchema,
  type TableItemContent,
  type TextItemContent,
} from '../schema/test'
import { withDefaultPoints } from './generate'
import { objectCall, rawTextOf, startLadder, type AiCallListener, type CallMeter } from './ladder'
import {
  buildWorksheetItemPrompt,
  buildWorksheetPrompt,
  buildWorksheetSystemPrompt,
  type WorksheetRequest,
  type WorksheetTarget,
} from './prompts/worksheet'
import { readAiLadder, type AiConfig } from './provider'
import { fitMaterials } from './puzzleWords'
import { AI_SETTINGS } from './settings'

/**
 * Worksheet from the model: the whole worksheet in one call and regeneration
 * of a single item. The model does not reliably stick to the prompt rules, so
 * everything that can be verified (task shape, tables, text length) is
 * verified by `checkWorksheetItems` in code — a broken item is dropped and
 * the worksheet is built from the rest.
 */

const S = AI_SETTINGS.worksheet

/** Worksheet item after verification, ready to be saved. */
export type WorksheetItemDraft =
  | { kind: 'heading' | 'instruction'; text: string; needsCheck: false }
  | { kind: 'text'; text: string; content: TextItemContent; needsCheck: boolean }
  | { kind: 'table'; content: TableItemContent; needsCheck: boolean }
  | { kind: 'question'; question: QuestionContent; needsCheck: boolean }

export interface WorksheetResult {
  title: string
  items: WorksheetItemDraft[]
  /** How many items the model returned broken and were skipped. */
  dropped: number
  /** Models that answered (`provider:model`). */
  models: string[]
}

/** One model call; faked in tests so they never touch a real model. */
export type WorksheetCall = (input: {
  config: AiConfig
  system: string
  prompt: string
  signal?: AbortSignal
  meter?: CallMeter
}) => Promise<unknown>

export interface WorksheetAiOptions {
  /** Model ladder; read from the environment (`AI_MODELS`) without it. */
  models?: AiConfig[]
  signal?: AbortSignal
  /** Fake model call for tests; not passed in the app. */
  callModel?: WorksheetCall
  /** Listener for call attempts (AI usage overview); core only passes it to the ladder. */
  onCall?: AiCallListener
}

/** Error when the model did not return enough usable items for a worksheet. */
export function worksheetTooFewMessage(): string {
  return t('ai:worksheet.tooFew')
}

/** Error when regenerating a worksheet item failed. */
export function worksheetItemFailedMessage(): string {
  return t('ai:worksheet.itemFailed')
}

const fromMaterials = z.boolean()

/** Item as the model returns it. Table without cross-field checks — those happen in code. */
const modelItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heading'), text: z.string(), fromMaterials }),
  z.object({ kind: z.literal('instruction'), text: z.string(), fromMaterials }),
  z.object({ kind: z.literal('text'), variant: z.enum(TEXT_ITEM_VARIANTS), text: z.string(), fromMaterials }),
  z.object({ kind: z.literal('table'), table: tableItemShapeSchema, fromMaterials }),
  z.object({ kind: z.literal('question'), question: questionContentSchema, fromMaterials }),
])

const worksheetResponseSchema = z.object({ title: z.string(), items: z.array(modelItemSchema).min(1) })
const itemResponseSchema = z.object({ item: modelItemSchema })

/** Verifies one item; a broken one returns `null`. */
function checkItem(raw: unknown, hasSource: boolean): WorksheetItemDraft | null {
  const parsed = modelItemSchema.safeParse(raw)
  if (!parsed.success) return null
  const item = parsed.data
  // Without supplied text nothing can be based on the materials, whatever the model claims.
  const needsCheck = !hasSource || !item.fromMaterials

  switch (item.kind) {
    case 'heading':
    case 'instruction': {
      const text = item.text.trim()
      return text ? { kind: item.kind, text, needsCheck: false } : null
    }
    case 'text': {
      const text = item.text.trim()
      // A longer text is dropped, not trimmed — a cut-off sentence makes no sense.
      if (!text || text.length > S.textMax) return null
      return { kind: 'text', text, content: { variant: item.variant }, needsCheck }
    }
    case 'table': {
      const table = tableItemContentSchema.safeParse(item.table)
      return table.success ? { kind: 'table', content: table.data, needsCheck } : null
    }
    case 'question': {
      if (validateQuestionContent(item.question).length > 0) return null
      const question = withDefaultPoints(normalizeMatchingPayload(normalizeOrderingPayload(item.question)))
      return { kind: 'question', question, needsCheck }
    }
  }
}

/**
 * Goes through the model's items: drops (and counts) broken ones, turns
 * `fromMaterials: false` into the "check" flag. Without materials and own
 * text (`hasSource`) everything except headings and instructions gets the
 * flag.
 */
export function checkWorksheetItems(
  raw: unknown[],
  options: { hasSource: boolean },
): { items: WorksheetItemDraft[]; dropped: number } {
  const items: WorksheetItemDraft[] = []
  let dropped = 0
  for (const candidate of raw) {
    const item = checkItem(candidate, options.hasSource)
    if (item) items.push(item)
    else dropped += 1
  }
  return { items, dropped }
}

/**
 * The only place where the model ladder is built for worksheets. An answer in
 * the wrong shape is not discarded entirely: the raw JSON is returned and the
 * items are salvaged one by one (pattern: batch salvage for questions).
 */
async function callWorksheet(
  schema: z.ZodType,
  system: string,
  prompt: string,
  options: WorksheetAiOptions,
): Promise<{ value: unknown; models: string[] }> {
  const ladder = startLadder(options.models ?? readAiLadder(), options.signal, options.onCall)
  const call: WorksheetCall = options.callModel ?? objectCall(schema)
  try {
    const { value } = await ladder.call((config, meter) => call({ config, system, prompt, signal: options.signal, meter }))
    return { value, models: ladder.used }
  } catch (error) {
    const raw = rawTextOf(error)
    if (raw === null) throw error
    try {
      return { value: JSON.parse(raw) as unknown, models: ladder.used }
    } catch {
      throw error
    }
  }
}

function hasSource(request: WorksheetRequest): boolean {
  return Boolean(request.materials.trim() || request.ownText.trim())
}

function materialsFor(request: WorksheetRequest): string {
  return fitMaterials(request.materials, S.materialChars, S.materialChunkChars)
}

/** Generates the whole worksheet in one model call. Saves nothing. */
export async function generateWorksheet(
  request: WorksheetRequest,
  options: WorksheetAiOptions = {},
): Promise<WorksheetResult> {
  const { value, models } = await callWorksheet(
    worksheetResponseSchema,
    buildWorksheetSystemPrompt(request.gradeName),
    buildWorksheetPrompt(request, materialsFor(request)),
    options,
  )
  const answer = (value ?? {}) as { title?: unknown; items?: unknown }
  const raw = Array.isArray(answer.items) ? answer.items : []
  const { items, dropped } = checkWorksheetItems(raw, { hasSource: hasSource(request) })
  const kept = items.slice(0, S.maxItems)
  // A heading or instruction at the end of the worksheet (typically after trimming) has nothing to belong to.
  while (kept.length > 0 && isStructural(kept[kept.length - 1]!)) kept.pop()
  const content = kept.filter((item) => !isStructural(item))
  if (content.length < S.minItems) throw new Error(worksheetTooFewMessage() + describeDropped(dropped))
  const title = typeof answer.title === 'string' && answer.title.trim() ? answer.title.trim() : request.title
  return { title, items: kept, dropped, models }
}

function isStructural(item: WorksheetItemDraft): boolean {
  return item.kind === 'heading' || item.kind === 'instruction'
}

/** Error suffix saying how many items the model broke — without it the teacher cannot tell whether another instruction would help. */
function describeDropped(dropped: number): string {
  if (dropped === 0) return ''
  return ` ${t('ai:worksheet.dropped', { count: dropped })}`
}

/** Does the item match what was requested? */
function matchesTarget(item: WorksheetItemDraft, target: WorksheetTarget): boolean {
  switch (target.kind) {
    case 'text':
    case 'fun_fact':
      return item.kind === 'text' && item.content.variant === target.kind
    case 'question':
      return item.kind === 'question' && item.question.type === target.questionType
    default:
      return item.kind === target.kind
  }
}

/**
 * New version of one worksheet item. `existing` are the texts of the other
 * items so they do not repeat. A broken item or an item of another kind ends
 * with a localized error — the worksheet does not change.
 */
export async function regenerateWorksheetItem(
  request: WorksheetRequest,
  target: WorksheetTarget,
  existing: string[],
  options: WorksheetAiOptions = {},
): Promise<WorksheetItemDraft> {
  const { value } = await callWorksheet(
    itemResponseSchema,
    buildWorksheetSystemPrompt(request.gradeName),
    buildWorksheetItemPrompt(request, materialsFor(request), target, existing),
    options,
  )
  const item = checkItem((value as { item?: unknown } | null)?.item, hasSource(request))
  if (!item || !matchesTarget(item, target)) throw new Error(worksheetItemFailedMessage())
  return item
}
