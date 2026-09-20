import { generateObject, NoObjectGeneratedError, type LanguageModel } from 'ai'
import { z } from 'zod'
import {
  DEFAULT_POINTS,
  normalizeOrderingPayload,
  questionContentSchema,
  validateQuestionContent,
  type QuestionContent,
  type QuestionType,
} from '../schema/question'
import { describeAiError } from './errors'
import { buildSystemPrompt, buildUserPrompt, type GenerationRequest } from './prompt'
import { describeAiConfig, getModel, readAiLadder, type AiConfig } from './provider'

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
 *
 * Modelů může být víc (žebříček z `AI_MODELS`). Přepíná se po dávce, ne po
 * celém tématu: když prvnímu modelu dojde uprostřed generování denní limit,
 * dogeneruje zbytek další model ze žebříčku a dávky, které už jsou hotové,
 * zůstávají (ukládá je `onBatch` průběžně). U chyby, která není na opakování
 * — chybný klíč, zrušený model — se nic dalšího nezkouší.
 */
export async function generateQuestions(
  request: GenerationRequest,
  options: {
    /** Jediný model — kdo si vybírá sám, žebříček nepotřebuje. */
    config?: AiConfig
    /** Konkrétní worker; při jeho zadání se nepoužívá fallback žebříček. */
    worker?: AiConfig
    /** Paralelní Ollama workeři; každá dávka dostane právě jednoho workeru. */
    workers?: AiConfig[]
    /** Žebříček modelů; přebíjí `config`. Bez obojího se čte z prostředí. */
    configs?: AiConfig[]
    signal?: AbortSignal
    onChunk?: (done: number, total: number) => void
    /**
     * Zavolá se po každé dokončené dávce, ať se dá ukládat průběžně. Dostane
     * i model, který dávku vyrobil — při přepnutí v žebříčku má každá dávka
     * jiný.
     */
    onBatch?: (questions: QuestionContent[], info: { model: string }) => Promise<void> | void
    /** Podvržené volání modelu pro testy; v aplikaci se nepředává. */
    callModel?: ModelCall
  } = {},
): Promise<GenerationResult> {
  const ladder =
    options.workers && options.workers.length > 0
      ? options.workers
      : options.worker
      ? [options.worker]
      : options.configs && options.configs.length > 0
      ? options.configs
      : options.config
        ? [options.config]
        : readAiLadder()

  const models = new Map<string, LanguageModel>()
  const callModel: ModelCall =
    options.callModel ??
    (async ({ config, system, prompt, signal }) => {
      const key = describeAiConfig(config)
      let model = models.get(key)
      if (!model) {
        model = await getModel(config)
        models.set(key, model)
      }
      const { object } = await generateObject({
        model,
        schema: responseSchema,
        system,
        prompt,
        abortSignal: signal,
        maxRetries: 2,
      })
      return { questions: object.questions }
    })

  /**
   * Modely, kterým v tomhle běhu došel limit (nebo jsou přetížené). Pamatují
   * se do konce běhu — jinak by se na vyčerpaný model naráželo u každé další
   * dávky znovu a každá by čekala na tutéž chybu.
   */
  const exhausted = new Set<string>()
  const used: string[] = []

  /** Jedna dávka: zkouší modely žebříčku, dokud některý neodpoví. */
  async function runBatch(system: string, prompt: string): Promise<{ questions: QuestionContent[]; model: string }> {
    let lastError: unknown = new Error('Žádný model k dispozici')
    for (const config of ladder) {
      const key = describeAiConfig(config)
      if (exhausted.has(key)) continue
      try {
        const result = await callModel({ config, system, prompt, signal: options.signal })
        if (!used.includes(key)) used.push(key)
        return { questions: result.questions, model: key }
      } catch (error) {
        // Přerušení uživatelem není důvod ke střídání modelů.
        if (options.signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw error
        // Odpověď přišla, jen se netrefila do tvaru — model funguje, dávku
        // zachrání volající (salvageQuestions). Přepínat nemá co.
        if (rawTextOf(error) !== null) {
          if (!used.includes(key)) used.push(key)
          throw error
        }
        // Chybný klíč nebo zrušený model — na tom nic nezmění ani další pokus,
        // natož jiný model ze žebříčku.
        if (!describeAiError(error).retryable) throw error
        exhausted.add(key)
        lastError = error
      }
    }
    // Žebříček došel: hotová práce je díky onBatch uložená, chyba posledního
    // modelu putuje nahoru, ať ji volající přeloží do češtiny.
    throw lastError
  }

  const chunks = chunkText(request.text)
  const perChunk = Math.max(1, Math.ceil(request.count / chunks.length))
  // Rozvrh typů pro celé generování (viz distributeTypes) — každá dávka si
  // z něj vezme jen svůj úsek podle toho, kolik otázek už je hotových.
  const typeSchedule = distributeTypes(request.types, request.count)

  const accepted: QuestionContent[] = []
  const rejected: GenerationResult['rejected'] = []
  const failedCalls: GenerationResult['failedCalls'] = []

  if (options.workers && options.workers.length > 0) {
    const tasks: { chunk: string; batchSize: number; types: QuestionType[]; worker: AiConfig }[] = []
    const concurrency = Math.max(
      1,
      Math.min(options.workers.length, Number(process.env.OLLAMA_CONCURRENCY) || options.workers.length),
    )
    const activeWorkers = options.workers.slice(0, concurrency)
    let workerIndex = 0
    for (const chunk of chunks) {
      const chunkBatches = splitIntoBatches(Math.min(perChunk, request.count))
      for (const batchSize of chunkBatches) {
        const batchTypes = typeSchedule.slice(tasks.length * MAX_PER_CALL, tasks.length * MAX_PER_CALL + batchSize)
        tasks.push({
          chunk,
          batchSize,
          types: batchTypes.length > 0 ? batchTypes : request.types,
          worker: activeWorkers[workerIndex++ % activeWorkers.length] as AiConfig,
        })
      }
    }

    type WorkerResult = Awaited<ReturnType<typeof callModel>> & { task: (typeof tasks)[number] }
    const results: WorkerResult[] = []
    const failures: { task: (typeof tasks)[number]; error: unknown }[] = []
    let nextTask = 0
    await Promise.all(
      activeWorkers.map(async (worker) => {
        while (true) {
          const task = tasks[nextTask++]
          if (!task) return
          const prompt = buildUserPrompt({
            ...request,
            text: task.chunk,
            count: task.batchSize,
            types: task.types,
            avoid: request.avoid,
          })
          try {
            const result = await callModel({ config: worker, system: buildSystemPrompt(request.gradeName), prompt, signal: options.signal })
            results.push({ ...result, task })
          } catch (error) {
            if (options.signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw error
            failures.push({ task, error })
          }
        }
      }),
    )

    const completed = [
      ...results.map((result) => ({ task: result.task, result })),
      ...failures.map((failure) => ({ task: failure.task, error: failure.error })),
    ]
    const seenPrompts = new Set(request.avoid ?? [])
    for (const [index, item] of completed.entries()) {
      if ('error' in item) {
        failedCalls.push({ reason: item.error instanceof Error ? item.error.message : String(item.error) })
        continue
      }
      const batch: QuestionContent[] = []
      for (const [offset, question] of item.result.questions.entries()) {
        const errors = validateQuestionContent(question)
        if (errors.length > 0) {
          rejected.push({ index: accepted.length + offset, errors })
          continue
        }
        const normalized = withDefaultPoints(normalizeOrderingPayload(question))
        const promptKey = promptOf(normalized)
        if (seenPrompts.has(promptKey)) continue
        seenPrompts.add(promptKey)
        batch.push(normalized)
      }
      accepted.push(...batch)
      if (batch.length > 0) await options.onBatch?.(batch, { model: describeAiConfig(item.task.worker) })
      if ((index + 1) % Math.max(1, tasks.length / chunks.length) === 0) {
        options.onChunk?.(Math.ceil((index + 1) / Math.max(1, tasks.length / chunks.length)), chunks.length)
      }
    }
    return { questions: accepted.slice(0, request.count), rejected, chunks: chunks.length, failedCalls, models: [...new Set(tasks.map((task) => describeAiConfig(task.worker)))] }
  }

  for (const [index, chunk] of chunks.entries()) {
    const remaining = request.count - accepted.length
    if (remaining <= 0) break

    for (const batchSize of splitIntoBatches(Math.min(perChunk, remaining))) {
      if (accepted.length >= request.count) break

      // Úsek celkového rozvrhu typů odpovídající téhle dávce. Pád na
      // request.types by nastal jen kdyby byl rozvrh kratší než count
      // (nemělo by se stát, ale ať dávka i tak dostane platné typy).
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
      let batchModel = describeAiConfig(ladder[0] as AiConfig)
      try {
        const result = await runBatch(buildSystemPrompt(request.gradeName), prompt)
        produced = result.questions
        batchModel = result.model
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
      if (batch.length > 0) await options.onBatch?.(batch, { model: batchModel })
    }

    options.onChunk?.(index + 1, chunks.length)
  }

  return {
    questions: accepted.slice(0, request.count),
    rejected,
    chunks: chunks.length,
    failedCalls,
    models: used,
  }
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
