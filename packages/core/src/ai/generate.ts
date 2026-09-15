import { generateObject, NoObjectGeneratedError } from 'ai'
import { z } from 'zod'
import {
  DEFAULT_POINTS,
  normalizeOrderingPayload,
  questionContentSchema,
  validateQuestionContent,
  type QuestionContent,
  type QuestionType,
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
 * Rozdělí `count` otázek mezi zadané typy po kolečku (round-robin), takže
 * výsledek je co nejrovnoměrnější bez ohledu na to, jestli je `count`
 * dělitelný počtem typů. Používá se pro celé generování, ne pro jednu dávku —
 * "rovnoměrně mezi devět typů" nedává smysl v dávce po pěti otázkách, ale dává
 * smysl napříč celým požadovaným počtem. Konkrétní dávka pak dostane jen svůj
 * úsek tohoto rozvrhu (viz volání v `generateQuestions`).
 */
export function distributeTypes(types: QuestionType[], count: number): QuestionType[] {
  if (types.length === 0 || count <= 0) return []
  const result: QuestionType[] = []
  for (let i = 0; i < count; i++) result.push(types[i % types.length] as QuestionType)
  return result
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
  // Rozvrh typů pro celé generování (viz distributeTypes) — každá dávka si
  // z něj vezme jen svůj úsek podle toho, kolik otázek už je hotových.
  const typeSchedule = distributeTypes(request.types, request.count)

  const accepted: QuestionContent[] = []
  const rejected: GenerationResult['rejected'] = []
  const failedCalls: GenerationResult['failedCalls'] = []

  for (const [index, chunk] of chunks.entries()) {
    const remaining = request.count - accepted.length
    if (remaining <= 0) break

    for (const batchSize of splitIntoBatches(Math.min(perChunk, remaining))) {
      if (accepted.length >= request.count) break

      // Úsek celkového rozvrhu typů odpovídající téhle dávce. Pád na
      // request.types by nastal jen kdyby byl rozvrh kratší než count
      // (nemělo by se stát, ale ať dávka i tak dostane platné typy).
      const batchTypes = typeSchedule.slice(accepted.length, accepted.length + batchSize)

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
            types: batchTypes.length > 0 ? batchTypes : request.types,
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
        batch.push(withDefaultPoints(normalizeOrderingPayload(question)))
      }

      accepted.push(...batch)
      if (batch.length > 0) await options.onBatch?.(batch)
    }

    options.onChunk?.(index + 1, chunks.length)
  }

  return { questions: accepted.slice(0, request.count), rejected, chunks: chunks.length, failedCalls }
}

/**
 * Body doplní podle typu, pokud model vrátil výchozí 1 nebo nesmyslně vysokou
 * hodnotu. Gemini u přiřazovacích otázek nabízelo i 25 bodů — na písemce pro
 * druhý stupeň to jednu otázku postaví nad zbytek testu. Učitelka si body může
 * kdykoli přepsat ručně, schéma proto širší rozsah dál připouští.
 */
const MAX_AI_POINTS = 10

function withDefaultPoints(question: QuestionContent): QuestionContent {
  if (question.points > 1 && question.points <= MAX_AI_POINTS) return question
  return { ...question, points: DEFAULT_POINTS[question.type] }
}

/**
 * Zadání otázky pro deduplikaci napříč částmi. U `true_false`, `fill_blank`
 * a `matching` bývá `prompt` obecná fráze ("Rozhodni, zda...") stejná pro
 * spoustu různých otázek — otisk proto musí vzít skutečný obsah (tvrzení,
 * doplňovaná slova, dvojice), jinak by se stejný obsah v jiném obalu
 * nerozpoznal jako duplicita.
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
