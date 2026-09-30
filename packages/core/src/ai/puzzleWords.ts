import { z } from 'zod'
import {
  PUZZLE_CLUE_MAX,
  PUZZLE_WORD_MAX,
  wordSearchPayloadSchema,
  type PuzzleEntry,
} from '../schema/puzzle'
import { phraseWords, splitWord } from '../puzzle/letters'
import { chunkText, pickChunks } from './generate'
import { objectCall, startLadder, type AiCallListener, type CallMeter } from './ladder'
import { readAiLadder, type AiConfig } from './provider'
import {
  buildPuzzleWordsPrompt,
  buildPuzzleWordsSystemPrompt,
  type MissingLetters,
  type PuzzleWordsPromptLimits,
  type PuzzleWordsRequest,
} from './prompts/puzzleWords'
import { AI_SETTINGS } from './settings'

/**
 * Slovní zásoba do hlavolamu od modelu.
 *
 * Model dodává **jen dvojice slovo + nápověda**, nikdy mřížku — v mřížce se
 * ztratí a vrátí slovo, které v ní neleží. Rozmístění dělá kód
 * (`packages/core/src/puzzle`).
 *
 * Jde se toutéž cestou jako u otázek: žebříček modelů (`AI_MODELS`), přepnutí
 * na další model při vyčerpaném limitu a překlad chyb do češtiny
 * (`describeAiError`). `PuzzleWordsRequest` a prompty žijí v `./prompts/puzzleWords`.
 *
 * Model se na pravidla z promptu spolehlivě nedrží (polovinu slov píše bez
 * diakritiky, občas slovo vymyslí nebo ho prozradí v nápovědě), proto
 * všechno, co jde ověřit, ověřuje `filterEntries` v kódu.
 */

const S = AI_SETTINGS.puzzleWords

export interface PuzzleWordsRejection {
  word: string
  /** Důvod česky, do rozhraní. */
  reason: string
}

export interface PuzzleWordsStats {
  /** O kolik slov se model žádal (u tajenky i s rezervou na chybějící písmena). */
  requested: number
  /** Kolik jich model vrátil. */
  returned: number
  /** Kolik jich prošlo kontrolou (= `entries.length`). */
  usable: number
  /** Kolik se jich zahodilo (= `rejected.length`). */
  dropped: number
}

export interface PuzzleWordsResult {
  entries: PuzzleEntry[]
  /** Slova, která se do hlavolamu nehodí (i s důvodem, česky). */
  rejected: PuzzleWordsRejection[]
  /** Slova, která kód opravil (diakritika podle materiálu, zkrácená nápověda). */
  adjusted: { word: string; note: string }[]
  /** Model, který odpověděl (`poskytovatel:model`). */
  models: string[]
  stats: PuzzleWordsStats
  /**
   * Písmena tajenky, na která ani po tomhle kole nezbylo slovo (i se slovy
   * z `avoid`). Jen u tajenky se zadanou větou.
   */
  missingLetters?: string[]
  /** Česká věta s radou, když výsledek na hlavolam nestačí; jinak chybí. */
  warning?: string
}

/** Jedno volání modelu; v testech se podstrkuje, aby nesahaly na skutečný model. */
export type PuzzleWordsCall = (input: {
  config: AiConfig
  system: string
  prompt: string
  signal?: AbortSignal
  meter?: CallMeter
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

/** Meze slova do hlavolamu: kratší se nedá hledat, delší se nevejde do mřížky. */
export const MIN_LETTERS = S.minLetters
/** Nejdelší slovo, které schéma hlavolamu vůbec pustí. */
const SCHEMA_MAX_LETTERS = PUZZLE_WORD_MAX
/** Nejdelší nápověda, kterou schéma hlavolamu pustí. */
export const CLUE_MAX_LENGTH = PUZZLE_CLUE_MAX
/** Výchozí mřížka osmisměrky — tatáž, kterou doplní schéma. */
const DEFAULT_GRID = wordSearchPayloadSchema.parse({})

/**
 * Nejdelší slovo pro daný hlavolam. V osmisměrce se slovo musí vejít aspoň
 * do delší strany mřížky; u tajenky rozhoduje šířka řádku na stránce.
 */
export function maxLettersFor(kind: PuzzleWordsRequest['kind'], grid?: { cols: number; rows: number }): number {
  if (kind === 'cryptogram') return Math.min(S.cryptogramMaxLetters, SCHEMA_MAX_LETTERS)
  const { cols, rows } = grid ?? DEFAULT_GRID
  return Math.min(Math.max(cols, rows), SCHEMA_MAX_LETTERS)
}

/** Kompatibilita: nejdelší slovo ve výchozí osmisměrce. */
export const MAX_LETTERS = maxLettersFor('wordsearch')

function promptLimits(request: PuzzleWordsRequest): PuzzleWordsPromptLimits {
  return {
    minLetters: S.minLetters,
    maxLetters: maxLettersFor(request.kind, request.grid),
    clueTarget: Math.min(S.clueTargetLength, CLUE_MAX_LENGTH),
    clueMax: CLUE_MAX_LENGTH,
  }
}

/**
 * Vytáhne z materiálů tématu dvojice slovo + nápověda.
 *
 * Co se do hlavolamu nehodí (slovo, které v materiálu není, moc dlouhé slovo,
 * dvě slova, nápověda, která slovo prozradí…), se zahodí a vrátí v `rejected`
 * — tichý úbytek by učitelka poznala až u prázdných řádků tajenky.
 */
export async function generatePuzzleWords(
  request: PuzzleWordsRequest,
  options: {
    /** Žebříček modelů; bez něj se čte z prostředí (`AI_MODELS`). */
    models?: AiConfig[]
    signal?: AbortSignal
    /** Podvržené volání modelu pro testy; v aplikaci se nepředává. */
    callModel?: PuzzleWordsCall
    /** Každý pokus o volání modelu (viz `startLadder`); web z něj zapisuje přehled použití. */
    onCall?: AiCallListener
  } = {},
): Promise<PuzzleWordsResult> {
  const ladder = startLadder(options.models ?? readAiLadder(), options.signal, options.onCall)
  const callModel: PuzzleWordsCall =
    options.callModel ??
    (() => {
      const call = objectCall(responseSchema)
      return async (input) => ({ words: (await call(input)).words })
    })()

  const phrase = request.kind === 'cryptogram' ? request.phrase?.trim() || undefined : undefined
  const avoid = request.avoid ?? []
  const missingBefore = phrase ? missingPhraseLetters(phrase, avoid) : []
  const count = wordsToRequest(request.count, phrase ? missingBefore.length : 0)
  const text = fitMaterials(request.text)
  const limits = promptLimits(request)

  const system = buildPuzzleWordsSystemPrompt(request.gradeName, limits)
  const prompt = buildPuzzleWordsPrompt(request, { count, text, missingLetters: countLetters(missingBefore) })
  // Slova nejde zachránit po kouscích jako otázky — špatný tvar znamená zkusit další model.
  const { value, model } = await ladder.call(
    (config, meter) => callModel({ config, system, prompt, signal: options.signal, meter }),
    { nextOnBadShape: true },
  )

  const filtered = filterEntries(value.words, {
    source: text,
    avoid,
    phrase,
    minLetters: limits.minLetters,
    maxLetters: limits.maxLetters,
    clueMax: limits.clueMax,
  })
  const stats: PuzzleWordsStats = {
    requested: count,
    returned: value.words.length,
    usable: filtered.entries.length,
    dropped: filtered.rejected.length,
  }
  const missingLetters = phrase
    ? missingPhraseLetters(phrase, [...avoid, ...filtered.entries.map((entry) => entry.word)])
    : undefined
  return {
    ...filtered,
    models: [model],
    stats,
    ...(missingLetters ? { missingLetters } : {}),
    ...warningFor(stats, filtered.rejected, missingLetters),
  }
}

/** Kolik slov chtít po modelu: u tajenky víc, než kolik chybí písmen. */
export function wordsToRequest(count: number, missingLetters: number): number {
  const reserve = Math.max(S.cryptogramMinExtraWords, Math.ceil(missingLetters * S.cryptogramExtraWordsRatio))
  const wanted = missingLetters > 0 ? Math.max(count, missingLetters + reserve) : count
  return Math.max(1, Math.min(wanted, S.maxWordsPerCall))
}

/** Hláška s radou, když výsledek na hlavolam nestačí. */
function warningFor(
  stats: PuzzleWordsStats,
  rejected: PuzzleWordsRejection[],
  missingLetters: string[] | undefined,
): { warning?: string } {
  const parts: string[] = []
  if (stats.usable === 0) {
    const reasons = summarizeReasons(rejected)
    parts.push(
      stats.returned === 0
        ? 'Model nevrátil žádné slovo.'
        : `Model vrátil ${wordCount(stats.returned)}, ale žádné se do hlavolamu nehodí${reasons ? ` (${reasons})` : ''}.`,
      'Zkus to znovu, případně zkontroluj, že téma má materiály s textem, nebo slova dopiš ručně.',
    )
  } else if (stats.usable * 2 < stats.requested) {
    parts.push(
      `Použitelných slov je jen ${stats.usable} z ${stats.requested}. Když je potřebuješ víc, nech dogenerovat další, nebo je dopiš ručně.`,
    )
  }
  if (missingLetters?.length) {
    parts.push(
      `Na písmena tajenky ${[...new Set(missingLetters)].join(', ')} zatím chybí slovo. ` +
        'Nech dogenerovat další slova, dopiš je ručně, nebo zvol jinou větu.',
    )
  }
  return parts.length > 0 ? { warning: parts.join(' ') } : {}
}

/** „1 slovo", „3 slova", „5 slov". */
function wordCount(n: number): string {
  return `${n} ${n === 1 ? 'slovo' : n >= 2 && n <= 4 ? 'slova' : 'slov'}`
}

/** „nenašlo se v materiálu 3×, …" — nejčastější důvody vyřazení. */
function summarizeReasons(rejected: PuzzleWordsRejection[]): string {
  const counts = new Map<string, number>()
  for (const { reason } of rejected) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, n]) => (n > 1 ? `${reason} ${n}×` : reason))
    .join(', ')
}

// ————————————————————————————————— materiály

const FILE_HEADER = /^=== .+ ===$/

/**
 * Text materiálů zkrácený na `budget` znaků tak, aby dostal prostor každý
 * soubor. Krátké materiály jdou celé, zbytek rozpočtu se dělí rovným dílem
 * mezi dlouhé (vodováha) a z dlouhého materiálu se berou úseky rovnoměrně
 * napříč celým textem — useknutý konec by znamenal, že poslední soubory
 * podle abecedy model vůbec neuvidí.
 */
export function fitMaterials(
  text: string,
  budget: number = S.materialChars,
  chunkChars: number = S.materialChunkChars,
): string {
  if (text.length <= budget) return text
  const materials = splitMaterials(text)
  const separator = '\n\n'
  let left = Math.max(budget - separator.length * (materials.length - 1), 0)
  const allowance = new Array<number>(materials.length).fill(0)
  const bySize = materials.map((_, i) => i).sort((a, b) => materials[a]!.length - materials[b]!.length)
  bySize.forEach((index, order) => {
    const share = Math.floor(left / (bySize.length - order))
    allowance[index] = Math.min(materials[index]!.length, share)
    left -= allowance[index]!
  })
  return materials
    .map((material, i) => sampleMaterial(material, allowance[i]!, chunkChars))
    .filter(Boolean)
    .join(separator)
}

/** Materiály podle záhlaví `=== soubor ===`, každý i se svým záhlavím. */
function splitMaterials(text: string): string[] {
  const materials: string[] = []
  let current: string[] = []
  for (const line of text.split('\n')) {
    if (FILE_HEADER.test(line.trim()) && current.join('').trim()) {
      materials.push(current.join('\n').trim())
      current = []
    }
    current.push(line)
  }
  if (current.join('').trim()) materials.push(current.join('\n').trim())
  return materials
}

const GAP = '\n[…]\n'

function sampleMaterial(material: string, allowance: number, chunkChars: number): string {
  if (material.length <= allowance) return material
  if (allowance <= 0) return ''
  const firstLine = material.split('\n', 1)[0] ?? ''
  const header = FILE_HEADER.test(firstLine.trim()) ? firstLine : ''
  const body = header ? material.slice(header.length).trim() : material
  const bodyBudget = allowance - (header ? header.length + 1 : 0)
  if (bodyBudget <= 0) return ''
  const chunks = chunkText(body, chunkChars)
  const take = Math.max(1, Math.floor(bodyBudget / (chunkChars + GAP.length)))
  const sampled = pickChunks(chunks, take).join(GAP).slice(0, bodyBudget)
  return header ? `${header}\n${sampled}` : sampled
}

// ————————————————————————————————— porovnávání slov

/** Bez diakritiky; u latinky zůstává počet znaků (kódových bodů) stejný. */
function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Klíč slova pro porovnání: jen písmena, malá, bez diakritiky. */
function looseKey(word: string): string {
  return stripDiacritics(splitWord(word).letters.join('').toLowerCase())
}

/** Jsou to tvary téhož slova? (kořen/kořeny, Ústava/ustava) */
export function isNearDuplicate(a: string, b: string): boolean {
  const x = looseKey(a)
  const y = looseKey(b)
  if (!x || !y) return false
  if (x === y) return true
  const [shorter, longer] = x.length <= y.length ? [x, y] : [y, x]
  return (
    shorter.length >= S.minLetters &&
    longer.startsWith(shorter) &&
    longer.length - shorter.length <= S.nearDuplicateExtraLetters
  )
}

/** Slova materiálu (malá, NFC, bez opakování) i jejich podoba bez diakritiky. */
interface MaterialIndex {
  tokens: string[]
  stripped: string[]
}

export function indexMaterial(text: string): MaterialIndex {
  const normalized = text
    .normalize('NFC')
    // Měkký spojovník a slovo rozdělené na konci řádku, stejně jako u citací otázek.
    .replace(/­/g, '')
    .replace(/-[ \t]*\r?\n\s*(?=\p{L})/gu, '')
    .toLowerCase()
  const tokens = [...new Set(normalized.match(/\p{L}+/gu) ?? [])]
  return { tokens, stripped: tokens.map(stripDiacritics) }
}

/**
 * Najde slovo v materiálu a vrátí ho v podobě z materiálu.
 *
 * Slovo projde, když ho materiál obsahuje jako slovo nebo začátek tvaru
 * (kořen → kořeny); u delších slov stačí shoda bez posledních dvou písmen,
 * protože 1. pád v textu stát nemusí (žaludek → žaludku). Když slovo sedí jen
 * po odstranění diakritiky (model napsal „zaludek"), vrátí se s diakritikou
 * z materiálu. Slovo, které v materiálu není, vrací `null`.
 */
export function matchInMaterial(word: string, index: MaterialIndex): string | null {
  const chars = Array.from(word.normalize('NFC'))
  const lower = chars.map((char) => char.toLowerCase())
  const full = lower.join('')
  const loose = stripDiacritics(full)
  const stemLength = Math.min(lower.length, Math.max(S.minLetters, lower.length - 2))
  const stem = lower.slice(0, stemLength).join('')
  const looseStem = stripDiacritics(stem)

  const stemFound = () => index.tokens.some((token) => token.startsWith(stem))

  if (index.tokens.some((token) => token.startsWith(full))) return chars.join('')
  // Slovo s diakritikou, jehož tvar v materiálu stojí (hříbek → hříbky), se
  // nepřepisuje podle jiného slova, které se liší jen čárkou.
  if (full !== loose && stemFound()) return chars.join('')
  const fixed = restoreDiacritics(chars, index, loose, lower.length, stemLength)
  if (fixed) return fixed
  if (stemFound()) return chars.join('')
  return restoreDiacritics(chars, index, looseStem, stemLength, stemLength)
}

/**
 * Prvních `length` znaků slova nahradí znaky z nejbližšího slova materiálu,
 * které bez diakritiky začíná na `loosePrefix`. Velikost písmen zůstane podle
 * modelu (Ústava zůstane s velkým Ú).
 *
 * Když v materiálu stojí jen delší tvar, přebírá se diakritika jen z kmene
 * (`stemLength`): z „bankovkách" se nesmí stát „bankovká", koncovka tvaru
 * s 1. pádem nesouvisí.
 */
function restoreDiacritics(
  chars: string[],
  index: MaterialIndex,
  loosePrefix: string,
  length: number,
  stemLength: number,
): string | null {
  let best: string | null = null
  let bestExact = false
  for (let i = 0; i < index.stripped.length; i++) {
    const stripped = index.stripped[i]!
    if (!stripped.startsWith(loosePrefix)) continue
    const token = index.tokens[i]!
    const exact = stripped === loosePrefix
    if (best === null || (exact && !bestExact) || (exact === bestExact && token.length < best.length)) {
      best = token
      bestExact = exact
    }
  }
  if (best === null) return null
  const source = Array.from(best)
  const restored = bestExact ? length : Math.min(length, stemLength)
  return chars
    .map((char, i) => {
      if (i >= restored) return char
      const replacement = source[i] ?? char
      return char === char.toUpperCase() && char !== char.toLowerCase() ? replacement.toUpperCase() : replacement
    })
    .join('')
}

/** Prozrazuje nápověda slovo? Hledá se jeho začátek (kořen) mezi slovy nápovědy. */
export function clueRevealsWord(word: string, clue: string): boolean {
  const key = looseKey(word)
  if (!key) return false
  const root = key.slice(0, S.clueRootLetters)
  const clueWords = stripDiacritics(clue.normalize('NFC').toLowerCase()).match(/\p{L}+/gu) ?? []
  return clueWords.some((clueWord) => clueWord.startsWith(root))
}

/**
 * Koncovky, které 1. pád jednotného čísla skoro nikdy nemá (bankovkách,
 * lesích, kořeny se svaly…). Gramatiku kód neověří, ale tyhle zjevné tvary
 * z textu materiálu ano; ostatní hlídá prompt.
 */
const NON_NOMINATIVE_ENDINGS = ['ách', 'ích', 'ami', 'ými', 'ých', 'ům']

export function looksNonNominative(word: string): boolean {
  const lower = word.normalize('NFC').toLowerCase()
  return Array.from(lower).length >= 6 && NON_NOMINATIVE_ENDINGS.some((ending) => lower.endsWith(ending))
}

function clueKey(clue: string): string {
  return stripDiacritics(clue.normalize('NFC').toLowerCase())
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Nápověda zkrácená pod `max` znaků: napřed na konci věty, jinak na konci
 * slova s výpustkou. Když by zbylo moc málo, vrací `null` a slovo se zahodí.
 */
export function trimClue(clue: string, max: number = CLUE_MAX_LENGTH): string | null {
  if (clue.length <= max) return clue
  const head = clue.slice(0, max)
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  let trimmed: string
  if (sentenceEnd >= S.clueMinTrimmedLength) {
    trimmed = head.slice(0, sentenceEnd + 1)
  } else {
    const space = clue.slice(0, max - 1).lastIndexOf(' ')
    trimmed = `${clue.slice(0, space > 0 ? space : max - 1).replace(/[\s,;:–-]+$/u, '')}…`
  }
  return trimmed.length >= S.clueMinTrimmedLength ? trimmed : null
}

// ————————————————————————————————— tajenka

/**
 * Písmena věty, na která se mezi `words` nenajde vlastní slovo. Počítá se
 * největší párování písmen se slovy (každé slovo pokryje jedno písmeno),
 * stejně jako při skládání tajenky — hladový odhad by hlásil chybějící
 * písmeno i tam, kde slova stačí.
 */
export function missingPhraseLetters(phrase: string, words: string[]): string[] {
  const letters = phraseWords(phrase).flat()
  const wordLetters = words.map((word) => new Set(splitWord(word).letters))
  const takenBy = new Array<number>(words.length).fill(-1)
  const assign = (letterIndex: number, visited: boolean[]): boolean => {
    for (let w = 0; w < wordLetters.length; w++) {
      if (visited[w] || !wordLetters[w]!.has(letters[letterIndex]!)) continue
      visited[w] = true
      if (takenBy[w] === -1 || assign(takenBy[w]!, visited)) {
        takenBy[w] = letterIndex
        return true
      }
    }
    return false
  }
  return letters.filter((_, i) => !assign(i, new Array<boolean>(words.length).fill(false)))
}

function countLetters(letters: string[]): MissingLetters {
  const counts = new Map<string, number>()
  for (const letter of letters) counts.set(letter, (counts.get(letter) ?? 0) + 1)
  return [...counts.entries()].map(([letter, count]) => ({ letter, count }))
}

// ————————————————————————————————— kontrola odpovědi

export interface FilterOptions {
  /** Text, který model dostal; slovo, které v něm není, se zahodí. Bez něj se nekontroluje. */
  source?: string
  /** Slova, která už v hlavolamu jsou. */
  avoid?: string[]
  /** Věta tajenky; slovo bez jediného jejího písmena se zahodí. */
  phrase?: string
  minLetters?: number
  maxLetters?: number
  clueMax?: number
}

/** Projde, co model vrátil, a nechá jen slova použitelná v hlavolamu. */
export function filterEntries(
  words: { word: string; clue: string }[],
  options: FilterOptions = {},
): { entries: PuzzleEntry[]; rejected: PuzzleWordsRejection[]; adjusted: { word: string; note: string }[] } {
  const minLetters = options.minLetters ?? S.minLetters
  const maxLetters = options.maxLetters ?? MAX_LETTERS
  const clueMax = options.clueMax ?? CLUE_MAX_LENGTH
  const index = options.source ? indexMaterial(options.source) : null
  const phraseLetters = options.phrase ? new Set(phraseWords(options.phrase).flat()) : null
  const avoid = (options.avoid ?? []).filter((word) => word.trim())

  const entries: PuzzleEntry[] = []
  const rejected: PuzzleWordsRejection[] = []
  const adjusted: { word: string; note: string }[] = []
  const clues = new Set<string>()

  for (const candidate of words) {
    let word = candidate.word.trim().normalize('NFC')
    let clue = candidate.clue.trim().replace(/\s+/g, ' ')
    const notes: string[] = []
    const reject = (reason: string) => rejected.push({ word, reason })

    if (!word) continue
    if (/\s/u.test(word)) {
      reject('je to víc slov, do hlavolamu patří jedno')
      continue
    }
    const { unusable } = splitWord(word)
    if (unusable.length > 0) {
      reject(`obsahuje znaky, které se do políček nezapíšou (${unusable.join(' ')})`)
      continue
    }
    if (index) {
      const found = matchInMaterial(word, index)
      if (found === null) {
        reject('v materiálu se nenašlo')
        continue
      }
      if (found !== word) {
        notes.push(`opraveno podle materiálu z „${word}"`)
        word = found
      }
    }
    const { letters } = splitWord(word)
    if (letters.length < minLetters) {
      reject(`je kratší než ${minLetters} písmena`)
      continue
    }
    if (letters.length > maxLetters) {
      reject(`je delší než ${maxLetters} písmen`)
      continue
    }
    if (looksNonNominative(word)) {
      reject('není v 1. pádě jednotného čísla')
      continue
    }
    if (clue.length < 2) {
      reject('chybí nápověda')
      continue
    }
    if (clue.length > clueMax) {
      const trimmed = trimClue(clue, clueMax)
      if (trimmed === null) {
        reject(`nápověda je delší než ${clueMax} znaků`)
        continue
      }
      notes.push('nápověda zkrácena')
      clue = trimmed
    }
    if (clueRevealsWord(word, clue)) {
      reject('nápověda prozrazuje hledané slovo')
      continue
    }
    if (avoid.some((existing) => isNearDuplicate(existing, word))) {
      reject('už v hlavolamu je')
      continue
    }
    if (entries.some((entry) => isNearDuplicate(entry.word, word))) {
      reject('je v seznamu podruhé')
      continue
    }
    const key = clueKey(clue)
    if (clues.has(key)) {
      reject('má stejnou nápovědu jako jiné slovo')
      continue
    }
    if (phraseLetters && !letters.some((letter) => phraseLetters.has(letter))) {
      reject('neobsahuje žádné písmeno tajenky')
      continue
    }
    clues.add(key)
    entries.push({ word, clue })
    if (notes.length > 0) adjusted.push({ word, note: notes.join(', ') })
  }

  return { entries, rejected, adjusted }
}
