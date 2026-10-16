import { z } from 'zod'
import { t } from '../i18n'
import {
  normalizeMatchingPayload,
  normalizeOrderingPayload,
  questionContentSchema,
  validateQuestionContent,
  type QuestionContent,
} from '../schema/question'
import { objectCall, rawTextOf, startLadder, type AiCallListener, type CallMeter } from './ladder'
import {
  buildCompletionPrompt,
  buildCompletionSystemPrompt,
  type AnswerCompletionRequest,
  type QuestionDraft,
} from './prompts/completeAnswers'
import { readAiLadder, type AiConfig } from './provider'
import { fitMaterials } from './puzzleWords'
import { AI_SETTINGS } from './settings'

/**
 * Completing the answers of a question the teacher wrote herself. The model
 * proposes values; `mergeCompletion` takes only those for fields that are
 * still empty, so neither the prompt nor anything she typed ever changes.
 * Two steps: first strictly from the topic's materials — when the answer is
 * not there, nothing is filled and the teacher decides whether general
 * knowledge may be used (second call).
 */

const S = AI_SETTINGS.answerCompletion

/** The model's answer. One flat object for all types — the merge reads only what the type needs. */
export const completionResponseSchema = z.object({
  foundInMaterials: z.boolean(),
  reason: z.string(),
  answer: z.string().optional(),
  acceptedAnswers: z.array(z.string()).optional(),
  options: z.array(z.object({ text: z.string(), correct: z.boolean() })).optional(),
  statements: z.array(z.object({ text: z.string(), isTrue: z.boolean() })).optional(),
  blanks: z.array(z.string()).optional(),
  right: z.array(z.string()).optional(),
  correctOrder: z.array(z.number().int()).optional(),
  tableAnswers: z.array(z.string()).optional(),
  explanation: z.string().optional(),
})

export type CompletionResponse = z.infer<typeof completionResponseSchema>

export type AnswerCompletion =
  /** Step one found no support in the materials (or there are none); nothing is filled. */
  | { status: 'not_found'; reason: string }
  | { status: 'filled'; question: QuestionContent; fromMaterials: boolean }

export type CompletionCall = (input: {
  config: AiConfig
  system: string
  prompt: string
  signal?: AbortSignal
  meter?: CallMeter
}) => Promise<unknown>

export interface CompletionOptions {
  /** Model ladder; read from the environment (`AI_MODELS`) without it. */
  models?: AiConfig[]
  signal?: AbortSignal
  /** Fake model call for tests; not passed in the app. */
  callModel?: CompletionCall
  onCall?: AiCallListener
}

/** Error when the model's answer cannot be merged into a valid question. */
export function completionBrokenMessage(): string {
  return t('ai:completion.broken')
}

/** Reason shown when the topic has no materials to look the answer up in. */
export function completionNoMaterialsMessage(): string {
  return t('ai:completion.noMaterials')
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const strings = (value: unknown) => (Array.isArray(value) ? value.map(str).filter(Boolean) : [])
const norm = (value: string) => value.trim().toLowerCase()

/** The payload with the model's values in place of empty fields; `null` when the model left a gap. */
function mergePayload(draft: QuestionDraft, a: CompletionResponse): Record<string, unknown> | null {
  const p = draft.payload
  switch (draft.type) {
    case 'open':
    case 'draw':
      return { ...p, answer: str(p.answer) || str(a.answer) }

    case 'short_answer': {
      const answer = str(p.answer) || str(a.answer)
      const own = strings(p.acceptedAnswers)
      const accepted = own.length
        ? own
        : [...new Set(strings(a.acceptedAnswers))].filter((value) => norm(value) !== norm(answer)).slice(0, 10)
      return { ...p, answer, acceptedAnswers: accepted }
    }

    case 'single_choice':
    case 'multi_choice': {
      const raw = Array.isArray(p.options) ? p.options : []
      const own = strings(p.options)
      // All options written: the marked answer is hers too, nothing to fill.
      if (own.length === raw.length && own.length >= S.choiceOptions) return p
      const proposed = (a.options ?? []).map((o) => ({ text: o.text.trim(), correct: o.correct })).filter((o) => o.text)
      const merged = own.map((text) => ({ text, correct: proposed.find((o) => norm(o.text) === norm(text))?.correct ?? false }))
      for (const option of proposed) {
        if (!merged.some((o) => norm(o.text) === norm(option.text))) merged.push(option)
      }
      const max = draft.type === 'single_choice' ? 8 : 10
      const options = merged.slice(0, max)
      const correct = options.flatMap((o, i) => (o.correct ? [i] : []))
      const texts = options.map((o) => o.text)
      if (draft.type === 'single_choice') {
        return correct.length === 1 ? { ...p, options: texts, correctIndex: correct[0] } : null
      }
      return correct.length > 0 ? { ...p, options: texts, correctIndices: correct } : null
    }

    case 'true_false': {
      const own = (Array.isArray(p.statements) ? p.statements : [])
        .map((s) => ({ text: str((s as { text?: unknown })?.text) }))
        .filter((s) => s.text)
      const proposed = a.statements ?? []
      if (own.length === 0) return { ...p, statements: proposed.map((s) => ({ text: s.text.trim(), isTrue: s.isTrue })).filter((s) => s.text) }
      if (proposed.length < own.length) return null
      return { ...p, statements: own.map((s, i) => ({ text: s.text, isTrue: proposed[i]!.isTrue })) }
    }

    case 'fill_blank': {
      const count = (str(p.text).match(/___/g) ?? []).length
      const own = strings(p.blanks)
      return { ...p, blanks: own.length === count ? own : strings(a.blanks) }
    }

    case 'matching': {
      const left = strings(p.left)
      const rawRight = Array.isArray(p.right) ? p.right : []
      const right = strings(p.right)
      // Both columns written: the pairs she set are the answer, nothing to fill.
      if (right.length === rawRight.length && right.length >= left.length) return p
      const proposed = strings(a.right)
      if (proposed.length < left.length) return null
      const fromModel = right.length === 0
      const pairs = left.map((_, i) => {
        let index = right.findIndex((value) => norm(value) === norm(proposed[i]!))
        if (index === -1) index = right.push(proposed[i]!) - 1
        return [i, index]
      })
      const payload = { ...p, left, right, pairs }
      // Only a right column the model wrote may be rotated — hers keeps her order.
      return fromModel
        ? (normalizeMatchingPayload({ type: 'matching', payload } as QuestionContent).payload as Record<string, unknown>)
        : payload
    }

    case 'ordering': {
      if (!a.correctOrder) return null
      return { ...p, items: strings(p.items), correctOrder: a.correctOrder }
    }

    case 'table_fill': {
      const rows = (Array.isArray(p.rows) ? p.rows : []).map((row) =>
        Array.isArray(row) ? row.map((cell) => (str(cell) ? (cell as string) : null)) : [],
      )
      const count = rows.flat().filter((cell) => cell === null).length
      const own = strings(p.answers)
      return { ...p, rows, answers: own.length === count ? own : strings(a.tableAnswers) }
    }
  }
}

/**
 * Merges the model's answer into the draft: only empty fields are filled,
 * the prompt and everything the teacher typed stay as they are. The result
 * passes the same schema and checks as a saved question; `null` when it
 * does not (the model's answer is broken and nothing should change).
 */
export function mergeCompletion(draft: QuestionDraft, answer: CompletionResponse): QuestionContent | null {
  const payload = mergePayload(draft, answer)
  if (!payload) return null
  const parsed = questionContentSchema.safeParse({
    type: draft.type,
    payload,
    points: draft.points,
    difficulty: draft.difficulty,
    explanation: str(draft.explanation) || str(answer.explanation) || undefined,
  })
  if (!parsed.success) return null
  const question = parsed.data as QuestionContent
  if (validateQuestionContent(question).length > 0) return null
  return normalizeOrderingPayload(question)
}

/**
 * One step of completing the answers. Step one (`allowGeneralKnowledge:
 * false`) without any materials does not call the model at all — there is
 * nothing to keep to, so the teacher goes straight to the confirmation.
 * Saves nothing.
 */
export async function completeQuestionAnswers(
  request: AnswerCompletionRequest,
  options: CompletionOptions = {},
): Promise<AnswerCompletion> {
  if (!request.allowGeneralKnowledge && !request.materials.trim()) {
    return { status: 'not_found', reason: completionNoMaterialsMessage() }
  }
  const materials = fitMaterials(request.materials, S.materialChars, S.materialChunkChars)
  const system = buildCompletionSystemPrompt(request.gradeName)
  const prompt = buildCompletionPrompt(request, materials)
  const ladder = startLadder(options.models ?? readAiLadder(), options.signal, options.onCall)
  const call: CompletionCall = options.callModel ?? objectCall(completionResponseSchema)
  let value: unknown
  try {
    value = (await ladder.call((config, meter) => call({ config, system, prompt, signal: options.signal, meter }))).value
  } catch (error) {
    if (rawTextOf(error) === null) throw error
    throw new Error(completionBrokenMessage())
  }
  const parsed = completionResponseSchema.safeParse(value)
  if (!parsed.success) throw new Error(completionBrokenMessage())
  if (!request.allowGeneralKnowledge && !parsed.data.foundInMaterials) {
    return { status: 'not_found', reason: parsed.data.reason.trim() }
  }
  const question = mergeCompletion(request.draft, parsed.data)
  if (!question) throw new Error(completionBrokenMessage())
  return { status: 'filled', question, fromMaterials: !request.allowGeneralKnowledge }
}
