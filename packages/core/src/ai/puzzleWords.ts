import { z } from 'zod'
import type { PuzzleEntry } from '../schema/puzzle'
import { splitWord } from '../puzzle/letters'
import { objectCall, startLadder } from './ladder'
import { readAiLadder, type AiConfig } from './provider'
import { buildPuzzleWordsPrompt, buildPuzzleWordsSystemPrompt, type PuzzleWordsRequest } from './prompts/puzzleWords'

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
 */

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

/** Meze slova do hlavolamu: kratší se nedá hledat, delší se nevejde do mřížky. */
export const MIN_LETTERS = 3
export const MAX_LETTERS = 14

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
    /** Žebříček modelů; bez něj se čte z prostředí (`AI_MODELS`). */
    models?: AiConfig[]
    signal?: AbortSignal
    /** Podvržené volání modelu pro testy; v aplikaci se nepředává. */
    callModel?: PuzzleWordsCall
  } = {},
): Promise<PuzzleWordsResult> {
  const ladder = startLadder(options.models ?? readAiLadder(), options.signal)
  const callModel: PuzzleWordsCall =
    options.callModel ??
    (() => {
      const call = objectCall(responseSchema)
      return async (input) => ({ words: (await call(input)).words })
    })()
  const system = buildPuzzleWordsSystemPrompt()
  const prompt = buildPuzzleWordsPrompt(request)
  // Slova nejde zachránit po kouscích jako otázky — špatný tvar znamená zkusit další model.
  const { value, model } = await ladder.call(
    (config) => callModel({ config, system, prompt, signal: options.signal }),
    { nextOnBadShape: true },
  )
  return { ...filterEntries(value.words), models: [model] }
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
    entries.push({ word, clue })
  }

  return { entries, rejected }
}
