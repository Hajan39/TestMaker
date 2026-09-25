import { z } from 'zod'
import {
  AI_QUESTION_TYPES,
  DEFAULT_POINTS,
  normalizeOrderingPayload,
  questionContentSchema,
  validateQuestionContent,
  type QuestionContent,
  type QuestionType,
} from '../schema/question'
import { objectCall, rawTextOf, startLadder } from './ladder'
import { buildSystemPrompt, buildUserPrompt, type GenerationRequest } from './prompts/questions'
import { readAiLadder, type AiConfig } from './provider'
import { AI_SETTINGS } from './settings'

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
  /**
   * Modely, které v tomhle běhu opravdu odpověděly, v pořadí, jak se braly
   * ze žebříčku (`poskytovatel:model`). Když je jich víc, míchaly se v jednom
   * tématu otázky z různých modelů — a protože se kvalita mezi modely liší,
   * musí to být vidět v hlášce po doběhnutí.
   */
  models: string[]
}

/** Jedno volání modelu — v testech se podstrkuje, aby nesahaly na skutečný model. */
export type ModelCall = (input: {
  config: AiConfig
  system: string
  prompt: string
  signal?: AbortSignal
}) => Promise<{ questions: QuestionContent[] }>

const FILE_HEADER = /^=== .+ ===$/

function firstLine(text: string): string {
  return (text.split('\n', 1)[0] ?? '').trim()
}

/**
 * Rozdělí příliš dlouhý kus textu na části do `maxChars`: po řádcích,
 * a když je i řádek moc dlouhý (text z PDF bývá jeden nekonečný řádek), po
 * větách. Věta delší než limit zůstane celá.
 */
function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const pieces = text.includes('\n') ? text.split('\n') : text.split(/(?<=[.!?])\s+/)
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
 * Rozdělí dlouhý text na části na hranicích odstavců. Záhlaví `=== soubor ===`
 * se přenáší do každé další části téhož souboru — model podle něj vyplňuje
 * `evidence.fileName`.
 */
export function chunkText(text: string, maxChars: number = AI_SETTINGS.maxCharsPerCall): string[] {
  if (text.length <= maxChars) return [text]
  const parts: string[] = []
  let current = ''
  let header: string | null = null

  for (const paragraph of text.split(/\n\n+/)) {
    if (FILE_HEADER.test(firstLine(paragraph))) header = firstLine(paragraph)

    for (const piece of splitLong(paragraph, maxChars)) {
      const onlyHeader = current.trim() === '' || current.trim() === header
      if (!onlyHeader && current.length + piece.length + 2 > maxChars) {
        parts.push(current.trim())
        current = header && !FILE_HEADER.test(firstLine(piece)) ? `${header}\n` : ''
      }
      current += `${piece}\n\n`
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/**
 * Když je úseků víc než otázek, vybere je rovnoměrně po celém materiálu —
 * jinak by u dlouhého tématu a pár otázek padly všechny na první kapitoly.
 */
export function pickChunks(chunks: string[], count: number): string[] {
  if (chunks.length <= count) return chunks
  return Array.from({ length: count }, (_, i) => chunks[Math.floor((i * chunks.length) / count)] as string)
}

/** Rozdělí požadovaný počet otázek na dávky, které se vejdou do jednoho volání. */
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

/**
 * Body doplní podle typu, pokud model vrátil výchozí 1 nebo nesmyslně vysokou
 * hodnotu. Gemini u přiřazovacích otázek nabízelo i 25 bodů — na písemce pro
 * druhý stupeň to jednu otázku postaví nad zbytek testu. Učitelka si body může
 * kdykoli přepsat ručně, schéma proto širší rozsah dál připouští.
 */
export function withDefaultPoints(question: QuestionContent): QuestionContent {
  if (question.points > 1 && question.points <= AI_SETTINGS.maxAiPoints) return question
  return { ...question, points: DEFAULT_POINTS[question.type] }
}

export const EVIDENCE_NOT_FOUND = 'citace v evidence se v materiálu nenašla'

/**
 * Text pro porovnání citace s materiálem: bez rozdílu velikosti písmen,
 * uvozovek a bílých znaků. Model citaci opisuje a drobnosti mění; kvůli nim
 * se otázka zahodit nesmí.
 */
function normalizeForMatch(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[„“”"'‚‘’«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Stojí citace z `evidence` opravdu v materiálu? Citace se dělí na vypuštění
 * („…", „...") a každý kus musí v textu být. Otázka bez citace projde —
 * chybějící doklad je slabší prohřešek než vymyšlený.
 */
export function evidenceMatches(question: QuestionContent, source: string): boolean {
  const quote = question.evidence?.quote?.trim()
  if (!quote) return true
  const haystack = normalizeForMatch(source)
  const parts = quote
    .split(/…|\.\.\./)
    .map((part) => normalizeForMatch(part).replace(/[.,;:!?]+$/, '').trim())
    .filter((part) => part.length >= AI_SETTINGS.minEvidencePart)
  if (parts.length === 0) return true
  return parts.every((part) => haystack.includes(part))
}

/** Všechny důvody, proč otázku nepustit do banky: tvar i doklad. */
export function checkQuestion(question: QuestionContent, source: string): string[] {
  const errors = validateQuestionContent(question)
  if (!evidenceMatches(question, source)) errors.push(EVIDENCE_NOT_FOUND)
  return errors
}

/**
 * Požadované typy zúžené na ty, které smí AI generovat. Ve frontě můžou čekat
 * úlohy založené dřív, s typy, které už model nedostává; ty se tiše vynechají.
 * Když nezbude nic, generuje se ze všech povolených.
 */
export function onlyAiTypes(types: QuestionType[]): QuestionType[] {
  const allowed = types.filter((t) => (AI_QUESTION_TYPES as readonly QuestionType[]).includes(t))
  return allowed.length > 0 ? allowed : [...AI_QUESTION_TYPES]
}

/**
 * Vygeneruje otázky k materiálu.
 *
 * Nevalidní otázky zahodí a vrátí v `rejected`. Když schéma odmítne celou
 * odpověď, zachrání z ní otázky, které v pořádku jsou. Modelů může být víc
 * (žebříček `AI_MODELS`); přepíná se po dávce, takže hotové dávky zůstávají
 * uložené (`onBatch`), i když prvnímu modelu uprostřed dojde limit.
 */
export async function generateQuestions(
  request: GenerationRequest,
  options: {
    /** Žebříček modelů; bez něj se čte z prostředí (`AI_MODELS`). */
    models?: AiConfig[]
    signal?: AbortSignal
    onChunk?: (done: number, total: number) => void
    /** Po každé dávce, ať se dá ukládat průběžně; dostane i model, který dávku vyrobil. */
    onBatch?: (questions: QuestionContent[], info: { model: string }) => Promise<void> | void
    /** Podvržené volání modelu pro testy; v aplikaci se nepředává. */
    callModel?: ModelCall
  } = {},
): Promise<GenerationResult> {
  request = { ...request, types: onlyAiTypes(request.types) }
  const ladder = startLadder(options.models ?? readAiLadder(), options.signal)
  const callModel: ModelCall =
    options.callModel ??
    (() => {
      const call = objectCall(responseSchema)
      return async (input) => ({ questions: (await call(input)).questions })
    })()
  const system = buildSystemPrompt(request.gradeName)

  const chunks = pickChunks(chunkText(request.text), request.count)
  const perChunk = Math.max(1, Math.ceil(request.count / chunks.length))
  // Rozvrh typů pro celé generování — každá dávka si vezme svůj úsek.
  const typeSchedule = distributeTypes(request.types, request.count)

  const accepted: QuestionContent[] = []
  const rejected: GenerationResult['rejected'] = []
  const failedCalls: GenerationResult['failedCalls'] = []

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
        // Nově vzniklé otázky jdou první, ať se ořezem seznamu neztratí.
        avoid: [...accepted.map(promptOf), ...(request.avoid ?? [])],
      })

      let produced: QuestionContent[] = []
      let batchModel = ''
      try {
        const result = await ladder.call((config) => callModel({ config, system, prompt, signal: options.signal }))
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
        batch.push(withDefaultPoints(normalizeOrderingPayload(question)))
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
