import { z } from 'zod'
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
 * Pracovní list od modelu: celý list jedním voláním a přegenerování jednoho
 * kusu. Model se pravidel z promptu spolehlivě nedrží, proto všechno, co jde
 * ověřit (tvar úlohy, tabulky, délka textu), ověřuje `checkWorksheetItems`
 * v kódu — vadná položka se vyřadí a list vznikne ze zbytku.
 */

const S = AI_SETTINGS.worksheet

/** Položka listu po ověření, připravená k uložení. */
export type WorksheetItemDraft =
  | { kind: 'heading' | 'instruction'; text: string; needsCheck: false }
  | { kind: 'text'; text: string; content: TextItemContent; needsCheck: boolean }
  | { kind: 'table'; content: TableItemContent; needsCheck: boolean }
  | { kind: 'question'; question: QuestionContent; needsCheck: boolean }

export interface WorksheetResult {
  title: string
  items: WorksheetItemDraft[]
  /** Kolik položek model nevrátil v pořádku a vynechaly se. */
  dropped: number
  /** Modely, které odpověděly (`poskytovatel:model`). */
  models: string[]
}

/** Jedno volání modelu; v testech se podstrkuje, aby nesahaly na skutečný model. */
export type WorksheetCall = (input: {
  config: AiConfig
  system: string
  prompt: string
  signal?: AbortSignal
  meter?: CallMeter
}) => Promise<unknown>

export interface WorksheetAiOptions {
  /** Žebříček modelů; bez něj se čte z prostředí (`AI_MODELS`). */
  models?: AiConfig[]
  signal?: AbortSignal
  /** Podvržené volání modelu pro testy; v aplikaci se nepředává. */
  callModel?: WorksheetCall
  /** Posluchač pokusů o volání (přehled použití AI); core ho jen předá žebříčku. */
  onCall?: AiCallListener
}

export const WORKSHEET_TOO_FEW_MESSAGE =
  'Model nevrátil dost použitelných položek na pracovní list. Zkus to znovu, případně uprav pokyn ' +
  '(třeba méně druhů položek) nebo přidej vlastní text.'

export const WORKSHEET_ITEM_FAILED_MESSAGE =
  'Model nevrátil položku v pořádku. Zkus přegenerování znovu, nebo položku uprav ručně.'

const fromMaterials = z.boolean()

/** Položka tak, jak ji model vrací. Tabulka bez kontrol napříč poli — ty jdou až v kódu. */
const modelItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heading'), text: z.string(), fromMaterials }),
  z.object({ kind: z.literal('instruction'), text: z.string(), fromMaterials }),
  z.object({ kind: z.literal('text'), variant: z.enum(TEXT_ITEM_VARIANTS), text: z.string(), fromMaterials }),
  z.object({ kind: z.literal('table'), table: tableItemShapeSchema, fromMaterials }),
  z.object({ kind: z.literal('question'), question: questionContentSchema, fromMaterials }),
])

const worksheetResponseSchema = z.object({ title: z.string(), items: z.array(modelItemSchema).min(1) })
const itemResponseSchema = z.object({ item: modelItemSchema })

/** Ověří jednu položku; vadná vrací `null`. */
function checkItem(raw: unknown, hasSource: boolean): WorksheetItemDraft | null {
  const parsed = modelItemSchema.safeParse(raw)
  if (!parsed.success) return null
  const item = parsed.data
  // Bez dodaného textu nemůže nic vycházet z materiálů, ať model tvrdí cokoli.
  const needsCheck = !hasSource || !item.fromMaterials

  switch (item.kind) {
    case 'heading':
    case 'instruction': {
      const text = item.text.trim()
      return text ? { kind: item.kind, text, needsCheck: false } : null
    }
    case 'text': {
      const text = item.text.trim()
      // Delší text se vyřadí, ne ořízne — useknutá věta nedává smysl.
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
 * Projde položky od modelu: vadné vyřadí (a spočítá), `fromMaterials: false`
 * převede na značku „ověř“. Bez materiálů i vlastního textu (`hasSource`)
 * dostane značku všechno kromě nadpisů a pokynů.
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
 * Jediné místo, kde se pro listy staví žebříček modelů. Odpověď ve špatném
 * tvaru se nezahazuje celá: vrátí se surové JSON a položky se zachrání po
 * jedné (vzor: záchrana dávky u otázek).
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

/** Vygeneruje celý pracovní list jedním voláním modelu. Nic neukládá. */
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
  const content = kept.filter((item) => item.kind !== 'heading' && item.kind !== 'instruction')
  if (content.length < S.minItems) throw new Error(WORKSHEET_TOO_FEW_MESSAGE)
  const title = typeof answer.title === 'string' && answer.title.trim() ? answer.title.trim() : request.title
  return { title, items: kept, dropped, models }
}

/** Sedí položka na to, o co se žádalo? */
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
 * Nová podoba jednoho kusu listu. `existing` jsou texty ostatních položek,
 * aby se neopakovaly. Vadná položka nebo položka jiného druhu končí českou
 * chybou — list se nemění.
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
  if (!item || !matchesTarget(item, target)) throw new Error(WORKSHEET_ITEM_FAILED_MESSAGE)
  return item
}
