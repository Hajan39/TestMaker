import { generateObject, NoObjectGeneratedError } from 'ai'
import { z } from 'zod'
import {
  DEFAULT_POINTS,
  questionContentSchema,
  validateQuestionContent,
  type QuestionContent,
} from '../schema/question'
import { buildSystemPrompt, buildUserPrompt, type GenerationRequest } from './prompt'
import { getModel, readAiConfig, type AiConfig } from './provider'

/** Maximální délka materiálu v jednom volání; delší se dělí na části. */
const MAX_CHARS_PER_CALL = 120_000

/**
 * Kolik otázek se žádá v jednom volání. Model vrací celou dávku jako jeden
 * objekt, takže čím je dávka větší, tím víc práce padne, když se u jedné otázky
 * netrefí do tvaru. Menší dávky ztrátu ohraničí a zároveň dovolí modelu držet
 * se u každé z nich zadaného typu.
 */
const MAX_PER_CALL = 5

const responseSchema = z.object({
  questions: z.array(questionContentSchema).min(1),
})

export interface GenerationResult {
  questions: QuestionContent[]
  /** Otázky zahozené kvůli nekonzistenci (index → důvody). */
  rejected: { index: number; errors: string[] }[]
  chunks: number
  /** Volání, ze kterých se nepodařilo použít vůbec nic. */
  failedCalls: { reason: string }[]
}

/** Rozdělí dlouhý text na části na hranicích odstavců. */
export function chunkText(text: string, maxChars = MAX_CHARS_PER_CALL): string[] {
  if (text.length <= maxChars) return [text]
  const parts: string[] = []
  let current = ''
  for (const paragraph of text.split(/\n\n+/)) {
    if (current.length + paragraph.length + 2 > maxChars && current) {
      parts.push(current.trim())
      current = ''
    }
    current += `${paragraph}\n\n`
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** Rozdělí požadovaný počet otázek na dávky, které se vejdou do jednoho volání. */
export function splitIntoBatches(count: number, perCall = MAX_PER_CALL): number[] {
  const batches: number[] = []
  let left = count
  while (left > 0) {
    batches.push(Math.min(perCall, left))
    left -= perCall
  }
  return batches
}

/**
 * Zachrání použitelné otázky z odpovědi, kterou schéma odmítlo jako celek.
 * Model občas u jedné otázky netrefí tvar; bez tohohle by s ní padly i ostatní.
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

/** Vytáhne z chyby surovou odpověď modelu, pokud ji nese. */
function rawTextOf(error: unknown): string | null {
  if (!NoObjectGeneratedError.isInstance(error)) return null
  const text = (error as { text?: unknown }).text
  return typeof text === 'string' ? text : null
}

/**
 * Vygeneruje otázky k materiálu.
 *
 * Nevalidní otázky zahodí a vrátí je v `rejected`. Když schéma odmítne celou
 * odpověď, pokusí se z ní vytáhnout aspoň otázky, které v pořádku jsou, aby
 * jedna špatně tvarovaná nezahodila práci ostatních.
 */
export async function generateQuestions(
  request: GenerationRequest,
  options: {
    config?: AiConfig
    signal?: AbortSignal
    onChunk?: (done: number, total: number) => void
    /** Zavolá se po každé dokončené dávce, ať se dá ukládat průběžně. */
    onBatch?: (questions: QuestionContent[]) => Promise<void> | void
  } = {},
): Promise<GenerationResult> {
  const config = options.config ?? readAiConfig()
  const model = await getModel(config)
  const chunks = chunkText(request.text)
  const perChunk = Math.max(1, Math.ceil(request.count / chunks.length))

  const accepted: QuestionContent[] = []
  const rejected: GenerationResult['rejected'] = []
  const failedCalls: GenerationResult['failedCalls'] = []

  for (const [index, chunk] of chunks.entries()) {
    const remaining = request.count - accepted.length
    if (remaining <= 0) break

    for (const batchSize of splitIntoBatches(Math.min(perChunk, remaining))) {
      if (accepted.length >= request.count) break

      let produced: QuestionContent[] = []
      try {
        const { object } = await generateObject({
          model,
          schema: responseSchema,
          system: buildSystemPrompt(),
          prompt: buildUserPrompt({
            ...request,
            text: chunk,
            count: batchSize,
            // Nově vzniklé otázky jdou první, ať se ořezem seznamu neztratí.
            avoid: [...accepted.map(promptOf), ...(request.avoid ?? [])],
          }),
          abortSignal: options.signal,
          maxRetries: 2,
        })
        produced = object.questions
      } catch (error) {
        const raw = rawTextOf(error)
        if (raw === null) throw error

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
        const errors = validateQuestionContent(question)
        if (errors.length > 0) {
          rejected.push({ index: accepted.length + i, errors })
          continue
        }
        batch.push(withDefaultPoints(question))
      }

      accepted.push(...batch)
      if (batch.length > 0) await options.onBatch?.(batch)
    }

    options.onChunk?.(index + 1, chunks.length)
  }

  return { questions: accepted.slice(0, request.count), rejected, chunks: chunks.length, failedCalls }
}

/** Body doplní podle typu, pokud model vrátil výchozí 1. */
function withDefaultPoints(question: QuestionContent): QuestionContent {
  if (question.points > 1) return question
  return { ...question, points: DEFAULT_POINTS[question.type] }
}

/** Zadání otázky pro deduplikaci napříč částmi. */
export function promptOf(question: QuestionContent): string {
  const payload = question.payload as Record<string, unknown>
  if (typeof payload.prompt === 'string' && payload.prompt) return payload.prompt
  if (typeof payload.text === 'string') return payload.text.slice(0, 120)
  return question.type
}
