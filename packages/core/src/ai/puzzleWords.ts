import { z } from 'zod'
import { t } from '../i18n'
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
 * Puzzle vocabulary from the model.
 *
 * The model supplies **only word + clue pairs**, never a grid — it gets lost
 * in a grid and returns a word that is not in it. Placement is done by code
 * (`packages/core/src/puzzle`).
 *
 * Same path as for questions: the model ladder (`AI_MODELS`), switching to
 * the next model when quota runs out, and translating errors for the teacher
 * (`describeAiError`). `PuzzleWordsRequest` and the prompts live in
 * `./prompts/puzzleWords`.
 *
 * The model does not reliably stick to the prompt rules (it writes half the
 * words without diacritics, sometimes makes a word up or reveals it in the
 * clue), so everything that can be verified is verified by `filterEntries`
 * in code.
 */

const S = AI_SETTINGS.puzzleWords

export interface PuzzleWordsRejection {
  word: string
  /** Reason for the UI, localized. */
  reason: string
}

export interface PuzzleWordsStats {
  /** How many words were requested from the model (for a cryptogram including a reserve for missing letters). */
  requested: number
  /** How many the model returned. */
  returned: number
  /** How many passed the check (= `entries.length`). */
  usable: number
  /** How many were dropped (= `rejected.length`). */
  dropped: number
}

export interface PuzzleWordsResult {
  entries: PuzzleEntry[]
  /** Words unfit for the puzzle (with a localized reason). */
  rejected: PuzzleWordsRejection[]
  /** Words fixed by code (diacritics from the material, trimmed clue). */
  adjusted: { word: string; note: string }[]
  /** Model that answered (`provider:model`). */
  models: string[]
  stats: PuzzleWordsStats
  /**
   * Cryptogram letters still without a word even after this round (including
   * the words from `avoid`). Only for a cryptogram with a given sentence.
   */
  missingLetters?: string[]
  /** Localized advice when the result is not enough for the puzzle; missing otherwise. */
  warning?: string
}

/** One model call; faked in tests so they never touch a real model. */
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

/** Puzzle word limits: shorter cannot be searched for, longer does not fit the grid. */
export const MIN_LETTERS = S.minLetters
/** Longest word the puzzle schema accepts at all. */
const SCHEMA_MAX_LETTERS = PUZZLE_WORD_MAX
/** Longest clue the puzzle schema accepts. */
export const CLUE_MAX_LENGTH = PUZZLE_CLUE_MAX
/** Default word search grid — the same one the schema fills in. */
const DEFAULT_GRID = wordSearchPayloadSchema.parse({})

/**
 * Longest word for the given puzzle. In a word search the word must fit at
 * least the longer side of the grid; for a cryptogram the row width on the
 * page decides.
 */
export function maxLettersFor(kind: PuzzleWordsRequest['kind'], grid?: { cols: number; rows: number }): number {
  if (kind === 'cryptogram') return Math.min(S.cryptogramMaxLetters, SCHEMA_MAX_LETTERS)
  const { cols, rows } = grid ?? DEFAULT_GRID
  return Math.min(Math.max(cols, rows), SCHEMA_MAX_LETTERS)
}

/** Compatibility: longest word in the default word search. */
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
 * Extracts word + clue pairs from the topic's materials.
 *
 * Whatever is unfit for the puzzle (a word not in the material, a too long
 * word, two words, a clue revealing the word…) is dropped and returned in
 * `rejected` — the teacher would notice a silent loss only at the empty rows
 * of the cryptogram.
 */
export async function generatePuzzleWords(
  request: PuzzleWordsRequest,
  options: {
    /** Model ladder; read from the environment (`AI_MODELS`) without it. */
    models?: AiConfig[]
    signal?: AbortSignal
    /** Fake model call for tests; not passed in the app. */
    callModel?: PuzzleWordsCall
    /** Every model call attempt (see `startLadder`); the web records the usage overview from it. */
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
  // Words cannot be salvaged piece by piece like questions — a bad shape means trying the next model.
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

/** How many words to ask the model for: for a cryptogram more than letters are missing. */
export function wordsToRequest(count: number, missingLetters: number): number {
  const reserve = Math.max(S.cryptogramMinExtraWords, Math.ceil(missingLetters * S.cryptogramExtraWordsRatio))
  const wanted = missingLetters > 0 ? Math.max(count, missingLetters + reserve) : count
  return Math.max(1, Math.min(wanted, S.maxWordsPerCall))
}

/** Message with advice when the result is not enough for the puzzle. */
function warningFor(
  stats: PuzzleWordsStats,
  rejected: PuzzleWordsRejection[],
  missingLetters: string[] | undefined,
): { warning?: string } {
  const parts: string[] = []
  if (stats.usable === 0) {
    const reasons = summarizeReasons(rejected)
    const words = t('ai:puzzleWords.wordCount', { count: stats.returned })
    parts.push(
      stats.returned === 0
        ? t('ai:puzzleWords.warnings.noWords')
        : reasons
          ? t('ai:puzzleWords.warnings.noneUsableWithReasons', { words, reasons })
          : t('ai:puzzleWords.warnings.noneUsable', { words }),
      t('ai:puzzleWords.warnings.retryHint'),
    )
  } else if (stats.usable * 2 < stats.requested) {
    parts.push(t('ai:puzzleWords.warnings.fewUsable', { usable: stats.usable, requested: stats.requested }))
  }
  if (missingLetters?.length) {
    parts.push(t('ai:puzzleWords.warnings.missingLetters', { letters: [...new Set(missingLetters)].join(', ') }))
  }
  return parts.length > 0 ? { warning: parts.join(' ') } : {}
}

/** "nenašlo se v materiálu 3×, …" — the most frequent rejection reasons. */
function summarizeReasons(rejected: PuzzleWordsRejection[]): string {
  const counts = new Map<string, number>()
  for (const { reason } of rejected) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, n]) => (n > 1 ? `${reason} ${n}×` : reason))
    .join(', ')
}

// ————————————————————————————————— materials

const FILE_HEADER = /^=== .+ ===$/

/**
 * Material text shortened to `budget` characters so that every file gets
 * room. Short materials go in whole, the rest of the budget is split equally
 * among the long ones (water-filling), and chunks are taken from a long
 * material evenly across the whole text — a cut-off end would mean the model
 * never sees the alphabetically last files.
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

/** Materials split by `=== file ===` headers, each with its header. */
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

// ————————————————————————————————— word comparison

/** Without diacritics; for Latin script the number of characters (code points) stays the same. */
function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Word key for comparison: letters only, lower case, without diacritics. */
function looseKey(word: string): string {
  return stripDiacritics(splitWord(word).letters.join('').toLowerCase())
}

/** Are these forms of the same word? (kořen/kořeny, Ústava/ustava) */
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

/** Material words (lower case, NFC, unique) and their form without diacritics. */
interface MaterialIndex {
  tokens: string[]
  stripped: string[]
}

export function indexMaterial(text: string): MaterialIndex {
  const normalized = text
    .normalize('NFC')
    // Soft hyphen and a word hyphenated at the end of a line, same as for question quotes.
    .replace(/­/g, '')
    .replace(/-[ \t]*\r?\n\s*(?=\p{L})/gu, '')
    .toLowerCase()
  const tokens = [...new Set(normalized.match(/\p{L}+/gu) ?? [])]
  return { tokens, stripped: tokens.map(stripDiacritics) }
}

/**
 * Finds the word in the material and returns it in the material's form.
 *
 * The word passes when the material contains it as a word or the start of a
 * form (kořen → kořeny); for longer words a match without the last two
 * letters is enough, because the nominative need not appear in the text
 * (žaludek → žaludku). When the word matches only after stripping diacritics
 * (the model wrote "zaludek"), it is returned with the diacritics from the
 * material. A word not in the material returns `null`.
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
  // A word with diacritics whose form is in the material (hříbek → hříbky) is
  // not rewritten after another word that differs only by an accent.
  if (full !== loose && stemFound()) return chars.join('')
  const fixed = restoreDiacritics(chars, index, loose, lower.length, stemLength)
  if (fixed) return fixed
  if (stemFound()) return chars.join('')
  return restoreDiacritics(chars, index, looseStem, stemLength, stemLength)
}

/**
 * Replaces the first `length` characters of the word with characters from the
 * closest material word that starts with `loosePrefix` without diacritics.
 * Letter case stays as the model wrote it (Ústava keeps its capital Ú).
 *
 * When only a longer form is in the material, diacritics are taken from the
 * stem only (`stemLength`): "bankovkách" must not become "bankovká", the
 * ending of that form has nothing to do with the nominative.
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

/** Does the clue reveal the word? Its start (root) is searched among the clue words. */
export function clueRevealsWord(word: string, clue: string): boolean {
  const key = looseKey(word)
  if (!key) return false
  const root = key.slice(0, S.clueRootLetters)
  const clueWords = stripDiacritics(clue.normalize('NFC').toLowerCase()).match(/\p{L}+/gu) ?? []
  return clueWords.some((clueWord) => clueWord.startsWith(root))
}

/**
 * Endings the nominative singular almost never has (bankovkách, lesích,
 * kořeny se svaly…). Code cannot verify grammar, but it can catch these
 * obvious forms from the material text; the prompt guards the rest.
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
 * Clue shortened below `max` characters: preferably at a sentence end,
 * otherwise at a word end with an ellipsis. When too little would remain,
 * returns `null` and the word is dropped.
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

// ————————————————————————————————— cryptogram

/**
 * Sentence letters for which no word of their own is found among `words`.
 * Computes the maximum matching of letters to words (each word covers one
 * letter), just like when building the cryptogram — a greedy estimate would
 * report a missing letter even where the words suffice.
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

// ————————————————————————————————— answer check

export interface FilterOptions {
  /** Text the model got; a word not in it is dropped. Without it nothing is checked. */
  source?: string
  /** Words already in the puzzle. */
  avoid?: string[]
  /** Cryptogram sentence; a word without any of its letters is dropped. */
  phrase?: string
  minLetters?: number
  maxLetters?: number
  clueMax?: number
}

/** Goes through what the model returned and keeps only words usable in the puzzle. */
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
      reject(t('ai:puzzleWords.rejected.multipleWords'))
      continue
    }
    const { unusable } = splitWord(word)
    if (unusable.length > 0) {
      reject(t('ai:puzzleWords.rejected.unusableChars', { chars: unusable.join(' ') }))
      continue
    }
    if (index) {
      const found = matchInMaterial(word, index)
      if (found === null) {
        reject(t('ai:puzzleWords.rejected.notInMaterial'))
        continue
      }
      if (found !== word) {
        notes.push(t('ai:puzzleWords.adjusted.fixedFromMaterial', { word }))
        word = found
      }
    }
    const { letters } = splitWord(word)
    if (letters.length < minLetters) {
      reject(t('ai:puzzleWords.rejected.tooShort', { count: minLetters }))
      continue
    }
    if (letters.length > maxLetters) {
      reject(t('ai:puzzleWords.rejected.tooLong', { count: maxLetters }))
      continue
    }
    if (looksNonNominative(word)) {
      reject(t('ai:puzzleWords.rejected.notNominative'))
      continue
    }
    if (clue.length < 2) {
      reject(t('ai:puzzleWords.rejected.missingClue'))
      continue
    }
    if (clue.length > clueMax) {
      const trimmed = trimClue(clue, clueMax)
      if (trimmed === null) {
        reject(t('ai:puzzleWords.rejected.clueTooLong', { count: clueMax }))
        continue
      }
      notes.push(t('ai:puzzleWords.adjusted.clueTrimmed'))
      clue = trimmed
    }
    if (clueRevealsWord(word, clue)) {
      reject(t('ai:puzzleWords.rejected.clueReveals'))
      continue
    }
    if (avoid.some((existing) => isNearDuplicate(existing, word))) {
      reject(t('ai:puzzleWords.rejected.alreadyInPuzzle'))
      continue
    }
    if (entries.some((entry) => isNearDuplicate(entry.word, word))) {
      reject(t('ai:puzzleWords.rejected.duplicate'))
      continue
    }
    const key = clueKey(clue)
    if (clues.has(key)) {
      reject(t('ai:puzzleWords.rejected.sameClue'))
      continue
    }
    if (phraseLetters && !letters.some((letter) => phraseLetters.has(letter))) {
      reject(t('ai:puzzleWords.rejected.noPhraseLetter'))
      continue
    }
    clues.add(key)
    entries.push({ word, clue })
    if (notes.length > 0) adjusted.push({ word, note: notes.join(', ') })
  }

  return { entries, rejected, adjusted }
}
