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
import { referencesSource } from './sourceReference'
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

/**
 * Oddělovač mezi kusy uvnitř úseku — i mezi přeneseným záhlavím a obsahem,
 * který za ním hned následuje. Musí to být tentýž řetězec, kterým se kusy
 * opravdu spojují, jinak rozpočet v `chunkText` počítá s jinou délkou
 * odřezu, než jaká se pak doopravdy připojí, a úsek limit přesáhne.
 */
const PIECE_SEPARATOR = '\n\n'

function firstLine(text: string): string {
  return (text.split('\n', 1)[0] ?? '').trim()
}

/**
 * Rozdělí příliš dlouhý kus textu na části do `maxChars`: po řádcích, a když
 * je i řádek moc dlouhý (text z PDF bývá jeden nekonečný řádek), po větách.
 * Když v textu nejsou ani řádky, ani konce vět (souvislý text bez tečky),
 * poslední záchrana je dělení po slovech — věta delší než limit se tak
 * rozpadne mezi slova a vcelku zůstane jen jediné slovo delší než limit samo
 * o sobě (dovnitř slova se neřeže).
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
 * Rozdělí dlouhý text na části na hranicích odstavců. Záhlaví `=== soubor ===`
 * se z odstavce vždy nejdřív vyjme a řeší se zvlášť od zbytku (`body`): dělí
 * se jen `body`, do rozpočtu zmenšeného o délku záhlaví a oddělovače za ním,
 * a záhlaví se pak výslovně připojí před každou takto vzniklou část — model
 * podle něj vyplňuje `evidence.fileName`. Díky tomuhle rozdělení `splitLong`
 * záhlaví nikdy neuvidí jako běžný řádek textu k rozdělení, takže žádná
 * část nemůže limit přesáhnout jinak než jedinou dovolenou výjimkou: slovo
 * bez mezer delší než rozpočet samo o sobě (dovnitř slova se neřeže, i kdyby
 * s připojeným záhlavím limit společně přesáhlo).
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
      // Nové záhlaví vždy začíná novou část, i kdyby se dosavadní obsah do
      // limitu ještě vešel — jinak by jedna část patřila dvěma souborům.
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
 * Když je úseků víc, než kolik se jich použije, vybere je rovnoměrně po celém
 * materiálu — jinak by u dlouhého tématu a pár otázek padly všechny na první
 * kapitoly.
 *
 * `offset` celé rozložení pootočí (s přetečením na začátek). Bez něj by každé
 * dogenerování i každá náhrada vybraly tytéž úseky a zbytek tématu by model
 * nikdy neviděl; generování proto posouvá podle počtu otázek, které už
 * v tématu jsou. Výběr zůstává bez opakování, protože se všechny indexy
 * posouvají o totéž.
 */
export function pickChunks(chunks: string[], count: number, offset: number = 0): string[] {
  const n = chunks.length
  if (n === 0) return []
  const shift = ((Math.trunc(offset) % n) + n) % n
  const at = (index: number) => chunks[(index + shift) % n] as string
  if (n <= count) return chunks.map((_, i) => at(i))
  return Array.from({ length: count }, (_, i) => at(Math.floor((i * n) / count)))
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
export const REFERENCES_SOURCE = 'otázka odkazuje na materiál místo toho, aby stála sama'

/**
 * Text pro porovnání citace s materiálem: bez rozdílu velikosti písmen,
 * uvozovek a bílých znaků. Model citaci opisuje a drobnosti mění; kvůli nim
 * se otázka zahodit nesmí.
 */
function normalizeForMatch(text: string): string {
  return (
    text
      .normalize('NFC')
      // Měkký spojovník z PDF v textu není vidět, model ho do citace nepřepíše.
      .replace(/\u00AD/g, '')
      // Slovo rozdělené na konci řádku („chloro-⏎fyl") model cituje vcelku.
      .replace(/-[ \t]*\r?\n\s*(?=\p{L})/gu, '')
      .toLowerCase()
      .replace(/[„“”"'‚‘’«»]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/**
 * Kusy citace k hledání v materiálu: citace se dělí na vypuštění („…",
 * „...") a kusy kratší než `minEvidencePart` se vynechají — našly by se
 * kdekoli. Prázdný výsledek znamená, že v citaci není co hledat.
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
 * Stojí citace z `evidence` opravdu v materiálu? Každý kus citace (viz
 * `quoteParts`) musí v textu být. Otázka bez citace projde — chybějící doklad
 * je slabší prohřešek než vymyšlený.
 */
export function evidenceMatches(question: QuestionContent, source: string): boolean {
  const parts = quoteParts(question.evidence?.quote)
  if (parts.length === 0) return true
  return quoteFoundIn(parts, source)
}

/**
 * Úseky, ze kterých se bude generovat. Když má požadavek `focus` (citaci
 * nahrazované otázky), jde první úsek, ve kterém ta citace stojí — náhrada
 * pak vzniká z téže pasáže, ne vždy z prvního úseku tématu. Zbytek (nebo
 * všechno, když se citace nenajde) se vybere rovnoměrně s posunem `offset`.
 */
export function selectChunks(chunks: string[], count: number, offset: number, focus?: string): string[] {
  const parts = quoteParts(focus)
  const hit = parts.length > 0 ? chunks.find((chunk) => quoteFoundIn(parts, chunk)) : undefined
  if (hit === undefined) return pickChunks(chunks, count, offset)
  if (count <= 1) return [hit]
  return [hit, ...pickChunks(chunks.filter((chunk) => chunk !== hit), count - 1, offset)]
}

/** Všechny důvody, proč otázku nepustit do banky: tvar i doklad. */
export function checkQuestion(question: QuestionContent, source: string): string[] {
  const errors = validateQuestionContent(question)
  if (!evidenceMatches(question, source)) errors.push(EVIDENCE_NOT_FOUND)
  if (referencesSource(question)) errors.push(REFERENCES_SOURCE)
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
  const system = buildSystemPrompt(request.gradeName, request.schoolRules)

  // Úseků jen tolik, kolik je potřeba plných dávek (viz `questionsPerCall`),
  // a posun podle toho, kolik otázek už v tématu je — další dogenerování tak
  // sáhne po jiných částech materiálu než to předchozí.
  const chunks = selectChunks(
    chunkText(request.text),
    Math.ceil(request.count / AI_SETTINGS.questionsPerCall),
    request.avoid?.length ?? 0,
    request.focus,
  )
  const perChunk = Math.max(1, Math.ceil(request.count / chunks.length))
  // Rozvrh typů pro celé generování — každá dávka si vezme svůj úsek.
  const typeSchedule = distributeTypes(request.types, request.count)

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
        const normalized = withDefaultPoints(normalizeOrderingPayload(question))
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
 * Klíč pro rozpoznání téže otázky: bez velikosti písmen, interpunkce
 * a rozdílů v mezerách. Model tutéž otázku často vrátí jen s jinou tečkou.
 */
export function dedupeKey(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
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

/**
 * Otisk otázky pro rozpoznání duplicit. U výběru z možností bývá zadání
 * obecné („Vyber správnou možnost.") a otázky se liší až možnostmi, proto
 * se k zadání přidají. Ostatní typy mají obsah už v `promptOf`.
 */
export function questionKey(question: QuestionContent): string {
  const prompt = promptOf(question)
  if (question.type === 'single_choice' || question.type === 'multi_choice') {
    return dedupeKey(`${prompt} ${question.payload.options.join(' / ')}`)
  }
  return dedupeKey(prompt)
}

/**
 * Kontrola duplicit pro jeden běh (generování nebo nahrání souboru). Otázky
 * z běhu se porovnávají celým otiskem (`questionKey`). Existující otázky
 * tématu jsou k dispozici jen jako zadání (`existing`), takže se s nimi
 * porovnává zadání. Vrací `true` pro duplicitu; jinak si otázku zapamatuje.
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
