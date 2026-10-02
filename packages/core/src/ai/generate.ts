import { z } from 'zod'
import { t } from '../i18n'
import {
  AI_QUESTION_TYPES,
  DEFAULT_POINTS,
  pointsByScope,
  normalizeGeneratedQuestion,
  aiQuestionContentSchema,
  questionContentSchema,
  validateQuestionContent,
  type QuestionContent,
  type QuestionType,
} from '../schema/question'
import { objectCall, rawTextOf, startLadder, type AiCallListener, type CallMeter } from './ladder'
import { buildSystemPrompt, buildUserPrompt, type GenerationRequest } from './prompts/questions'
import { readAiLadder, type AiConfig } from './provider'
import { referencesSource } from './sourceReference'
import { AI_SETTINGS } from './settings'

const responseSchema = z.object({
  questions: z.array(aiQuestionContentSchema).min(1),
})

export interface GenerationResult {
  questions: QuestionContent[]
  /** Questions dropped for inconsistency (index → reasons). */
  rejected: { index: number; errors: string[] }[]
  chunks: number
  /** Calls from which nothing at all could be used. */
  failedCalls: { reason: string }[]
  /**
   * Models that actually answered in this run, in the order they were taken
   * from the ladder (`provider:model`). When there are several, questions
   * from different models were mixed in one topic — and since quality differs
   * between models, this must be visible in the message after the run.
   */
  models: string[]
}

/** One model call — faked in tests so they never touch a real model. */
export type ModelCall = (input: {
  config: AiConfig
  system: string
  prompt: string
  signal?: AbortSignal
  meter?: CallMeter
}) => Promise<{ questions: QuestionContent[] }>

const FILE_HEADER = /^=== .+ ===$/

/**
 * Separator between pieces within a chunk — also between a carried-over
 * header and the content right after it. It must be the same string the
 * pieces are actually joined with, otherwise the budget in `chunkText`
 * counts with a different length than what is really appended and the chunk
 * exceeds the limit.
 */
const PIECE_SEPARATOR = '\n\n'

function firstLine(text: string): string {
  return (text.split('\n', 1)[0] ?? '').trim()
}

/**
 * Splits a too long piece of text into parts up to `maxChars`: by lines, and
 * when a line is too long as well (PDF text is often one endless line), by
 * sentences. When the text has neither lines nor sentence ends (continuous
 * text without a full stop), the last resort is splitting by words — a
 * sentence longer than the limit falls apart between words and only a single
 * word longer than the limit by itself stays whole (words are never cut).
 */
function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const bySentence = text.includes('\n') ? text.split('\n') : text.split(/(?<=[.!?])\s+/)
  const pieces = bySentence.length > 1 ? bySentence : text.split(/\s+/)
  if (pieces.length === 1) return pieces
  const parts: string[] = []
  let current = ''
  for (const piece of pieces.flatMap((p) => splitLong(p, maxChars))) {
    if (current && current.length + piece.length + 1 > maxChars) {
      parts.push(current)
      current = ''
    }
    current = current ? `${current} ${piece}` : piece
  }
  if (current) parts.push(current)
  return parts
}

/**
 * Splits a long text into parts at paragraph boundaries. A `=== file ===`
 * header is always taken out of the paragraph first and handled separately
 * from the rest (`body`): only `body` is split, into a budget reduced by the
 * length of the header and the separator after it, and the header is then
 * explicitly prepended to every resulting part — the model fills in
 * `evidence.fileName` from it. Thanks to this split `splitLong` never sees
 * the header as an ordinary line to split, so no part can exceed the limit
 * except for the single allowed exception: a word without spaces longer than
 * the budget by itself (words are never cut, even if together with the
 * header they exceed the limit).
 */
export function chunkText(text: string, maxChars: number = AI_SETTINGS.maxCharsPerCall): string[] {
  if (text.length <= maxChars) return [text]
  const parts: string[] = []
  let current = ''
  let header: string | null = null

  const flush = () => {
    if (current.trim() && current.trim() !== header) parts.push(current.trim())
    current = header ? `${header}${PIECE_SEPARATOR}` : ''
  }

  for (const paragraph of text.split(/\n\n+/)) {
    const first = firstLine(paragraph)
    let body = paragraph
    if (FILE_HEADER.test(first)) {
      header = first
      const afterHeader = paragraph.indexOf('\n')
      body = afterHeader === -1 ? '' : paragraph.slice(afterHeader + 1)
      // A new header always starts a new part, even if the content so far would
      // still fit the limit — otherwise one part would belong to two files.
      flush()
    }
    if (!body) continue

    const budget = header ? Math.max(maxChars - header.length - PIECE_SEPARATOR.length, 1) : maxChars
    for (const piece of splitLong(body, budget)) {
      if (current.trim() !== (header ?? '') && current.length + piece.length + PIECE_SEPARATOR.length > maxChars) {
        flush()
      }
      current += `${piece}${PIECE_SEPARATOR}`
    }
  }
  if (current.trim() && current.trim() !== header) parts.push(current.trim())
  return parts
}

/**
 * When there are more chunks than will be used, picks them evenly across the
 * whole material — otherwise for a long topic and a few questions all would
 * fall on the first chapters.
 *
 * `offset` rotates the whole distribution (wrapping to the start). Without it
 * every top-up and every replacement would pick the same chunks and the model
 * would never see the rest of the topic; generation therefore shifts by the
 * number of questions already in the topic. The selection stays without
 * repeats because all indices shift by the same amount.
 */
export function pickChunks(chunks: string[], count: number, offset: number = 0): string[] {
  const n = chunks.length
  if (n === 0) return []
  const shift = ((Math.trunc(offset) % n) + n) % n
  const at = (index: number) => chunks[(index + shift) % n] as string
  if (n <= count) return chunks.map((_, i) => at(i))
  return Array.from({ length: count }, (_, i) => at(Math.floor((i * n) / count)))
}

/** Splits the requested number of questions into batches that fit one call. */
export function splitIntoBatches(count: number, perCall: number = AI_SETTINGS.questionsPerCall): number[] {
  const batches: number[] = []
  let left = count
  while (left > 0) {
    batches.push(Math.min(perCall, left))
    left -= perCall
  }
  return batches
}

/**
 * Distributes `count` questions among the given types round-robin, so the
 * result is as even as possible regardless of whether `count` is divisible
 * by the number of types. Used for the whole generation, not for one batch —
 * "evenly across nine types" makes no sense in a batch of five questions, but
 * it does across the whole requested count. A particular batch then gets only
 * its slice of this schedule (see the call in `generateQuestions`).
 */
export function distributeTypes(types: QuestionType[], count: number, offset: number = 0): QuestionType[] {
  if (types.length === 0 || count <= 0) return []
  const result: QuestionType[] = []
  for (let i = 0; i < count; i++) result.push(types[(i + offset) % types.length] as QuestionType)
  return result
}

/**
 * Salvages usable questions from an answer the schema rejected as a whole.
 * The model sometimes misses the shape of one question; without this the
 * others would fail along with it.
 */
export function salvageQuestions(raw: unknown): QuestionContent[] {
  const container = raw as { questions?: unknown }
  const list = Array.isArray(container?.questions) ? container.questions : Array.isArray(raw) ? raw : []

  const usable: QuestionContent[] = []
  for (const candidate of list) {
    const parsed = questionContentSchema.safeParse(candidate)
    if (parsed.success) usable.push(parsed.data)
  }
  return usable
}

/**
 * Question points from the model. Where they can be computed from the scope
 * of the answer (blanks, pairs, choice), `pointsByScope` decides and the
 * model's number is dropped. For open answers and drawings it is taken only
 * within reasonable limits — Gemini offered even 25 points and one question
 * then outweighs the whole test. The teacher can override points manually at
 * any time, so the schema still allows a wider range.
 */
export function withDefaultPoints(question: QuestionContent): QuestionContent {
  const byScope = pointsByScope(question)
  if (byScope !== null) return { ...question, points: byScope }
  if (question.points > 1 && question.points <= AI_SETTINGS.maxAiPoints) return question
  return { ...question, points: DEFAULT_POINTS[question.type] }
}

/** Rejection reason: the evidence quote is not in the material. */
export function evidenceNotFoundMessage(): string {
  return t('ai:questions.evidenceNotFound')
}

/** Rejection reason: the question refers to the material instead of standing on its own. */
export function referencesSourceMessage(): string {
  return t('ai:questions.referencesSource')
}

/**
 * Text for comparing a quote with the material: ignoring case, quotation
 * marks and whitespace. The model copies the quote and changes small details;
 * the question must not be dropped because of them.
 */
function normalizeForMatch(text: string): string {
  return (
    text
      .normalize('NFC')
      // A soft hyphen from a PDF is invisible in the text; the model does not copy it into the quote.
      .replace(/\u00AD/g, '')
      // A word hyphenated at the end of a line ("chloro-⏎fyl") is quoted whole by the model.
      .replace(/-[ \t]*\r?\n\s*(?=\p{L})/gu, '')
      .toLowerCase()
      .replace(/[„“”"'‚‘’«»]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Quote pieces to search for in the material: the quote is split at
 * ellipses ("…", "...") and pieces shorter than `minEvidencePart` are
 * skipped — they would match anywhere. An empty result means there is
 * nothing to search for in the quote.
 */
function quoteParts(quote: string | undefined): string[] {
  if (!quote?.trim()) return []
  return quote
    .split(/…|\.\.\./)
    .map((part) => normalizeForMatch(part).replace(/[.,;:!?]+$/, '').trim())
    .filter((part) => part.length >= AI_SETTINGS.minEvidencePart)
}

function quoteFoundIn(parts: string[], source: string): boolean {
  const haystack = normalizeForMatch(source)
  return parts.every((part) => haystack.includes(part))
}

/**
 * Is the quote from `evidence` really in the material? Every quote piece (see
 * `quoteParts`) must be in the text. A question without a quote passes —
 * missing evidence is a lesser offence than made-up evidence.
 */
export function evidenceMatches(question: QuestionContent, source: string): boolean {
  const parts = quoteParts(question.evidence?.quote)
  if (parts.length === 0) return true
  return quoteFoundIn(parts, source)
}

/**
 * Chunks to generate from. When the request has `focus` (the quote of the
 * question being replaced), the first chunk containing that quote goes first —
 * the replacement then comes from the same passage, not always from the
 * topic's first chunk. The rest (or everything, when the quote is not found)
 * is picked evenly with the `offset` shift.
 */
export function selectChunks(chunks: string[], count: number, offset: number, focus?: string): string[] {
  const parts = quoteParts(focus)
  const hit = parts.length > 0 ? chunks.find((chunk) => quoteFoundIn(parts, chunk)) : undefined
  if (hit === undefined) return pickChunks(chunks, count, offset)
  if (count <= 1) return [hit]
  return [hit, ...pickChunks(chunks.filter((chunk) => chunk !== hit), count - 1, offset)]
}

/** All reasons not to let the question into the bank: shape and evidence. */
export function checkQuestion(question: QuestionContent, source: string): string[] {
  const errors = validateQuestionContent(question)
  if (!evidenceMatches(question, source)) errors.push(evidenceNotFoundMessage())
  if (referencesSource(question)) errors.push(referencesSourceMessage())
  return errors
}

/**
 * Requested types narrowed to those the AI may generate. The queue may hold
 * older jobs with types the model no longer gets; those are silently skipped.
 * When nothing remains, all allowed types are used.
 */
export function onlyAiTypes(types: QuestionType[]): QuestionType[] {
  const allowed = types.filter((t) => (AI_QUESTION_TYPES as readonly QuestionType[]).includes(t))
  return allowed.length > 0 ? allowed : [...AI_QUESTION_TYPES]
}

/**
 * Generates questions for the material.
 *
 * Drops invalid questions and returns them in `rejected`. When the schema
 * rejects the whole answer, salvages the questions that are fine. There can
 * be several models (the `AI_MODELS` ladder); switching happens per batch,
 * so finished batches stay saved (`onBatch`) even when the first model runs
 * out of quota midway.
 */
export async function generateQuestions(
  request: GenerationRequest,
  options: {
    /** Model ladder; read from the environment (`AI_MODELS`) without it. */
    models?: AiConfig[]
    signal?: AbortSignal
    onChunk?: (done: number, total: number) => void
    /** After every batch, so saving can happen as it goes; also receives the model that made the batch. */
    onBatch?: (questions: QuestionContent[], info: { model: string }) => Promise<void> | void
    /** Fake model call for tests; not passed in the app. */
    callModel?: ModelCall
    /** Every model call attempt (see `startLadder`); the web records the usage overview from it. */
    onCall?: AiCallListener
  } = {},
): Promise<GenerationResult> {
  request = { ...request, types: onlyAiTypes(request.types) }
  const ladder = startLadder(options.models ?? readAiLadder(), options.signal, options.onCall)
  const callModel: ModelCall =
    options.callModel ??
    (() => {
      const call = objectCall(responseSchema)
      return async (input) => ({ questions: (await call(input)).questions })
    })()
  const system = buildSystemPrompt(request.gradeName, request.schoolRules)

  // Only as many chunks as full batches are needed (see `questionsPerCall`),
  // shifted by how many questions are already in the topic — the next top-up
  // thus reaches for other parts of the material than the previous one.
  const chunks = selectChunks(
    chunkText(request.text),
    Math.ceil(request.count / AI_SETTINGS.questionsPerCall),
    request.avoid?.length ?? 0,
    request.focus,
  )
  const perChunk = Math.max(1, Math.ceil(request.count / chunks.length))
  // Type schedule for the whole generation — each batch takes its slice. It is
  // shifted by the questions already in the topic, like the chunks: otherwise
  // every top-up of five would start with the same five types and the rest
  // would never come.
  const typeSchedule = distributeTypes(request.types, request.count, request.avoid?.length ?? 0)

  const accepted: QuestionContent[] = []
  const rejected: GenerationResult['rejected'] = []
  const failedCalls: GenerationResult['failedCalls'] = []
  const isDuplicate = duplicateCheck(request.avoid ?? [])

  for (const [index, chunk] of chunks.entries()) {
    const remaining = request.count - accepted.length
    if (remaining <= 0) break

    for (const batchSize of splitIntoBatches(Math.min(perChunk, remaining))) {
      if (accepted.length >= request.count) break

      const batchTypes = typeSchedule.slice(accepted.length, accepted.length + batchSize)
      const prompt = buildUserPrompt({
        ...request,
        text: chunk,
        count: batchSize,
        types: batchTypes.length > 0 ? batchTypes : request.types,
        // Newly created questions go first so trimming the list does not lose them.
        avoid: [...accepted.map(promptOf), ...(request.avoid ?? [])],
      })

      let produced: QuestionContent[] = []
      let batchModel = ''
      try {
        const result = await ladder.call((config, meter) =>
          callModel({ config, system, prompt, signal: options.signal, meter }),
        )
        produced = result.value.questions
        batchModel = result.model
      } catch (error) {
        const raw = rawTextOf(error)
        if (raw === null) throw error
        batchModel = ladder.used.at(-1) ?? ''
        try {
          produced = salvageQuestions(JSON.parse(raw))
        } catch {
          produced = []
        }
        if (produced.length === 0) {
          failedCalls.push({ reason: error instanceof Error ? error.message : String(error) })
          continue
        }
      }

      const batch: QuestionContent[] = []
      for (const [i, question] of produced.entries()) {
        const errors = checkQuestion(question, chunk)
        if (errors.length > 0) {
          rejected.push({ index: accepted.length + i, errors })
          continue
        }
        const normalized = withDefaultPoints(normalizeGeneratedQuestion(question))
        if (isDuplicate(normalized)) continue
        batch.push(normalized)
      }

      accepted.push(...batch)
      if (batch.length > 0) await options.onBatch?.(batch, { model: batchModel })
    }

    options.onChunk?.(index + 1, chunks.length)
  }

  return {
    questions: accepted.slice(0, request.count),
    rejected,
    chunks: chunks.length,
    failedCalls,
    models: ladder.used,
  }
}

/**
 * Key for recognising the same question: ignoring case, punctuation and
 * whitespace differences. The model often returns the same question with
 * just a different full stop.
 */
export function dedupeKey(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Question prompt for deduplication across parts. For `true_false`,
 * `fill_blank` and `matching` the `prompt` is often a generic phrase
 * ("Rozhodni, zda...") shared by many different questions — the fingerprint
 * must therefore take the actual content (statements, blank words, pairs),
 * otherwise the same content in a different wrapper would not be recognised
 * as a duplicate.
 */
export function promptOf(question: QuestionContent): string {
  switch (question.type) {
    case 'true_false':
      return question.payload.statements.map((s) => s.text).join(' / ')
    case 'fill_blank':
      return `${question.payload.text.slice(0, 120)} [${question.payload.blanks.join(', ')}]`
    case 'matching':
      return `${question.payload.left.join(', ')} — ${question.payload.right.join(', ')}`
    default: {
      const payload = question.payload as Record<string, unknown>
      if (typeof payload.prompt === 'string' && payload.prompt) return payload.prompt
      if (typeof payload.text === 'string') return payload.text.slice(0, 120)
      return question.type
    }
  }
}

/**
 * Question fingerprint for recognising duplicates. For choice questions the
 * prompt is often generic ("Vyber správnou možnost.") and questions differ
 * only in their options, so those are added to the prompt. Other types
 * already have their content in `promptOf`.
 */
export function questionKey(question: QuestionContent): string {
  const prompt = promptOf(question)
  if (question.type === 'single_choice' || question.type === 'multi_choice') {
    return dedupeKey(`${prompt} ${question.payload.options.join(' / ')}`)
  }
  return dedupeKey(prompt)
}

/**
 * Duplicate check for one run (generation or file upload). Questions from the
 * run are compared by their full fingerprint (`questionKey`). Existing topic
 * questions are available only as prompts (`existing`), so the prompt is
 * compared with them. Returns `true` for a duplicate; otherwise remembers
 * the question.
 */
export function duplicateCheck(existing: string[]): (question: QuestionContent) => boolean {
  const existingKeys = new Set(existing.map(dedupeKey))
  const seen = new Set<string>()
  return (question) => {
    const key = questionKey(question)
    if (seen.has(key) || existingKeys.has(dedupeKey(promptOf(question)))) return true
    seen.add(key)
    return false
  }
}
