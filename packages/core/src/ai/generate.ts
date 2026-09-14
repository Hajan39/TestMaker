import { generateObject } from 'ai'
import { z } from 'zod'
import {
  DEFAULT_POINTS,
  questionContentSchema,
  validateQuestionContent,
  type QuestionContent,
} from '../schema/question.js'
import { buildSystemPrompt, buildUserPrompt, type GenerationRequest } from './prompt.js'
import { getModel, readAiConfig, type AiConfig } from './provider.js'

/** Maximální délka materiálu v jednom volání; delší se dělí na části. */
const MAX_CHARS_PER_CALL = 120_000

const responseSchema = z.object({
  questions: z.array(questionContentSchema).min(1),
})

export interface GenerationResult {
  questions: QuestionContent[]
  /** Otázky zahozené kvůli nekonzistenci (index → důvody). */
  rejected: { index: number; errors: string[] }[]
  chunks: number
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

/** Vygeneruje otázky k materiálu. Nevalidní otázky zahodí a vrátí je v `rejected`. */
export async function generateQuestions(
  request: GenerationRequest,
  options: { config?: AiConfig; signal?: AbortSignal; onChunk?: (done: number, total: number) => void } = {},
): Promise<GenerationResult> {
  const config = options.config ?? readAiConfig()
  const model = await getModel(config)
  const chunks = chunkText(request.text)
  const perChunk = Math.max(1, Math.ceil(request.count / chunks.length))

  const accepted: QuestionContent[] = []
  const rejected: GenerationResult['rejected'] = []

  for (const [index, chunk] of chunks.entries()) {
    const remaining = request.count - accepted.length
    if (remaining <= 0) break
    const count = Math.min(perChunk, remaining)

    const { object } = await generateObject({
      model,
      schema: responseSchema,
      system: buildSystemPrompt(),
      prompt: buildUserPrompt({
        ...request,
        text: chunk,
        count,
        avoid: [...(request.avoid ?? []), ...accepted.map(promptOf)],
      }),
      abortSignal: options.signal,
      maxRetries: 2,
    })

    for (const [i, question] of object.questions.entries()) {
      const errors = validateQuestionContent(question)
      if (errors.length > 0) {
        rejected.push({ index: accepted.length + i, errors })
        continue
      }
      accepted.push(withDefaultPoints(question))
    }

    options.onChunk?.(index + 1, chunks.length)
  }

  return { questions: accepted.slice(0, request.count), rejected, chunks: chunks.length }
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
