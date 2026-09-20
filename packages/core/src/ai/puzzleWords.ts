import { generateObject, type LanguageModel } from 'ai'
import { z } from 'zod'
import { PUZZLE_KIND_LABELS, type PuzzleEntry, type PuzzleKind } from '../schema/puzzle'
import { splitWord } from '../puzzle/letters'
import { describeAiError } from './errors'
import { describeAiConfig, getModel, readAiLadder, type AiConfig } from './provider'

/**
 * Slovní zásoba do hlavolamu od modelu.
 *
 * Model dodává **jen dvojice slovo + nápověda**, nikdy mřížku — v mřížce se
 * ztratí a vrátí slovo, které v ní neleží. Rozmístění dělá kód
 * (`packages/core/src/puzzle`).
 *
 * Jde se toutéž cestou jako u otázek: žebříček modelů (`AI_MODELS`), přepnutí
 * na další model při vyčerpaném limitu a překlad chyb do češtiny
 * (`describeAiError`).
 */

export interface PuzzleWordsRequest {
  /** Text materiálů tématu (celá skupina, ne jeden soubor). */
  text: string
  topicName: string
  subjectName: string
  /** Např. „8. ročník"; ovlivňuje jazykovou úroveň nápověd. */
  gradeName: string | null
  /** Kolik dvojic se má vrátit. */
  count: number
  kind: PuzzleKind
  /** Slova, která už v hlavolamu jsou — model má dodat jiná. */
  avoid?: string[]
}

export interface PuzzleWordsResult {
  entries: PuzzleEntry[]
  /** Slova, která se do hlavolamu nehodí (i s důvodem, česky). */
  rejected: { word: string; reason: string }[]
  /** Model, který odpověděl (`poskytovatel:model`). */
  models: string[]
}

/** Jedno volání modelu; v testech se podstrkuje, aby nesahaly na skutečný model. */
export type PuzzleWordsCall = (input: {
  config: AiConfig
  system: string
  prompt: string
  signal?: AbortSignal
}) => Promise<{ words: { word: string; clue: string }[] }>

const responseSchema = z.object({
  words: z
    .array(
      z.object({
        word: z.string(),
        clue: z.string(),
      }),
    )
    .min(1),
})

/** Nejdelší text materiálů, který se modelu posílá — na slovní zásobu stačí. */
const MAX_CHARS = 60_000

/** Meze slova do hlavolamu: kratší se nedá hledat, delší se nevejde do mřížky. */
const MIN_LETTERS = 3
const MAX_LETTERS = 14

export function buildPuzzleWordsSystemPrompt(): string {
  return [
    'Jsi zkušený učitel na české základní škole a chystáš dětem hlavolam z probrané látky.',
    '',
    'Pravidla, která platí bez výjimky:',
    '1. Vycházej výhradně z dodaného materiálu. Nepřidávej pojmy, které v něm nejsou.',
    '2. Každá položka `word` musí být právě jedno samostatné slovo: jedno podstatné jméno v 1. pádě jednotného čísla.',
    '   Nikdy neuváděj sousloví ani více slov. Slovo nesmí obsahovat mezery, pomlčky, spojovníky ani číslice.',
    `3. Slovo má ${MIN_LETTERS} až ${MAX_LETTERS} písmen. Diakritiku piš normálně (list, kořen, chloroplast).`,
    '4. Nápověda je jedna krátká školní věta nebo opis, ze kterého žák slovo uhodne. Nikdy v ní slovo samo neuveď.',
    '5. Nápověda má nejvýš 60 znaků, je samostatná a nepoužívá odkazy na obrázky ani na strany materiálu.',
    '6. Nápověda musí vést k jedinému slovu ze seznamu; nepoužívej obecné definice, na které by odpovídalo více slov.',
    '7. Slovo musí být doložitelné v dodaném materiálu a nápověda musí odpovídat jeho významu v tomto materiálu.',
    '8. Slova se neopakují a neliší se jen tvarem téhož pojmu.',
    '9. Nevymýšlej vlastní názvy, zkratky, čísla ani odpovědi, které v materiálu nejsou.',
  ].join('\n')
}

export function buildPuzzleWordsPrompt(request: PuzzleWordsRequest): string {
  const sections = [
    `Předmět: ${request.subjectName}`,
    request.gradeName ? `Ročník: ${request.gradeName}` : 'Ročník: neurčen',
    `Téma: ${request.topicName}`,
    `Hlavolam: ${PUZZLE_KIND_LABELS[request.kind]}`,
    '',
    `Vyber přesně ${request.count} klíčových pojmů tématu a ke každému napiš nápovědu.`,
  ]
  if (request.kind === 'cryptogram') {
    sections.push(
      'U tajenky se slova píšou do políček podle nápovědy, proto musí být nápověda jednoznačná — na otázku smí sedět jediné slovo.',
      'Nápověda nesmí obsahovat hledané slovo ani jeho část a musí fungovat samostatně bez znalosti pořadí v seznamu.',
    )
  }
  if (request.avoid?.length) {
    sections.push('', 'Tahle slova už v hlavolamu jsou, vyber jiná:', ...request.avoid.map((word) => `- ${word}`))
  }
  sections.push('', 'Materiál:', '"""', request.text.slice(0, MAX_CHARS), '"""')
  return sections.join('\n')
}

/**
 * Vytáhne z materiálů tématu dvojice slovo + nápověda.
 *
 * Co se do hlavolamu nehodí (moc dlouhé slovo, dvě slova, chybějící
 * nápověda), se zahodí a vrátí v `rejected` — tichý úbytek by učitelka
 * poznala až u prázdných řádků tajenky.
 */
export async function generatePuzzleWords(
  request: PuzzleWordsRequest,
  options: {
    config?: AiConfig
    configs?: AiConfig[]
    workers?: AiConfig[]
    signal?: AbortSignal
    /** Podvržené volání modelu pro testy; v aplikaci se nepředává. */
    callModel?: PuzzleWordsCall
  } = {},
): Promise<PuzzleWordsResult> {
  const ladder =
    options.workers && options.workers.length > 0
      ? [options.workers[0] as AiConfig]
      : options.configs && options.configs.length > 0
      ? options.configs
      : options.config
        ? [options.config]
        : readAiLadder()

  const models = new Map<string, LanguageModel>()
  const callModel: PuzzleWordsCall =
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
      return { words: object.words }
    })

  const system = buildPuzzleWordsSystemPrompt()
  const prompt = buildPuzzleWordsPrompt(request)

  let lastError: unknown = new Error('Žádný model k dispozici')
  for (const config of ladder) {
    const key = describeAiConfig(config)
    try {
      const { words } = await callModel({ config, system, prompt, signal: options.signal })
      return { ...filterEntries(words), models: [key] }
    } catch (error) {
      if (options.signal?.aborted || (error as { name?: string })?.name === 'AbortError') throw error
      // Chybný klíč nebo zrušený model — na tom nic nezmění další model v žebříčku.
      if (!describeAiError(error).retryable) throw error
      lastError = error
    }
  }
  throw lastError
}

/** Projde, co model vrátil, a nechá jen slova použitelná v hlavolamu. */
export function filterEntries(
  words: { word: string; clue: string }[],
): { entries: PuzzleEntry[]; rejected: { word: string; reason: string }[] } {
  const entries: PuzzleEntry[] = []
  const rejected: { word: string; reason: string }[] = []
  const seen = new Set<string>()

  for (const candidate of words) {
    const word = candidate.word.trim()
    const clue = candidate.clue.trim()
    const { letters, unusable } = splitWord(word)

    if (!word) continue
    if (/\s/u.test(word)) {
      rejected.push({ word, reason: 'je to víc slov, do hlavolamu patří jedno' })
      continue
    }
    if (unusable.length > 0) {
      rejected.push({ word, reason: `obsahuje znaky, které se do políček nezapíšou (${unusable.join(' ')})` })
      continue
    }
    if (letters.length < MIN_LETTERS) {
      rejected.push({ word, reason: `je kratší než ${MIN_LETTERS} písmena` })
      continue
    }
    if (letters.length > MAX_LETTERS) {
      rejected.push({ word, reason: `je delší než ${MAX_LETTERS} písmen` })
      continue
    }
    if (clue.length < 2) {
      rejected.push({ word, reason: 'chybí nápověda' })
      continue
    }
    const key = letters.join('')
    if (seen.has(key)) {
      rejected.push({ word, reason: 'je v seznamu podruhé' })
      continue
    }
    seen.add(key)
    entries.push({ word, clue: clue.length > 200 ? `${clue.slice(0, 199)}…` : clue })
  }

  return { entries, rejected }
}
