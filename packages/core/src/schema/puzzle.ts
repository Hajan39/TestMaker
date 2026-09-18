import { z } from 'zod'

/**
 * Hlavolam — osmisměrka a tajenka.
 *
 * Vstupem je vždycky dvojice slovo + nápověda, nikdy surový text: mřížku
 * skládá kód (viz `packages/core/src/puzzle`), model dodává jen slovní
 * zásobu. Tvar hlavolamu má jedinou definici tady, stejně jako otázka —
 * databáze, model i vykreslení se řídí tímhle schématem.
 */

export const PUZZLE_KINDS = ['wordsearch', 'cryptogram'] as const
export type PuzzleKind = (typeof PUZZLE_KINDS)[number]

export const PUZZLE_KIND_LABELS: Record<PuzzleKind, string> = {
  wordsearch: 'Osmisměrka',
  cryptogram: 'Tajenka',
}

/** Slovo do hlavolamu i s nápovědou, kterou žák dostane na papíře. */
export const puzzleEntrySchema = z.object({
  word: z.string().min(2).max(24),
  /** Krátká školní nápověda; u osmisměrky se tiskne jen na přání. */
  clue: z.string().min(2).max(200),
})

export type PuzzleEntry = z.infer<typeof puzzleEntrySchema>

/** Meze mřížky osmisměrky — menší se nedá vyplnit, větší se nevejde na stránku. */
export const MIN_GRID_SIZE = 6
export const MAX_GRID_SIZE = 20

export const wordSearchPayloadSchema = z.object({
  cols: z.number().int().min(MIN_GRID_SIZE).max(MAX_GRID_SIZE).default(12),
  rows: z.number().int().min(MIN_GRID_SIZE).max(MAX_GRID_SIZE).default(12),
  /**
   * Losování je řízené seedem: táž slova a týž seed dají vždycky tutéž
   * mřížku, takže se hlavolam dá po měsíci vytisknout znovu beze změny.
   */
  seed: z.string().min(1).max(40).default('1'),
  /** Vypsat pod mřížku i nápovědy, ne jen slova. */
  showClues: z.boolean().default(false),
})

export const cryptogramPayloadSchema = z.object({
  /** Věta, která se má složit z označených písmen. */
  phrase: z.string().min(2).max(120),
  seed: z.string().min(1).max(40).default('1'),
})

const baseFields = {
  title: z.string().min(1).max(200),
  /** Pokyn pro žáka nad hlavolamem; prázdný = použije se výchozí podle druhu. */
  instructions: z.string().max(500).default(''),
  entries: z.array(puzzleEntrySchema).min(2).max(40),
}

export const puzzleContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('wordsearch'), payload: wordSearchPayloadSchema, ...baseFields }),
  z.object({ kind: z.literal('cryptogram'), payload: cryptogramPayloadSchema, ...baseFields }),
])

export type PuzzleContent = z.infer<typeof puzzleContentSchema>
export type WordSearchContent = Extract<PuzzleContent, { kind: 'wordsearch' }>
export type CryptogramContent = Extract<PuzzleContent, { kind: 'cryptogram' }>

/** Výchozí pokyn pro žáka, když si učitelka žádný nenapsala. */
export const DEFAULT_PUZZLE_INSTRUCTIONS: Record<PuzzleKind, string> = {
  wordsearch:
    'Najdi v mřížce všechna slova ze seznamu. Slova jsou schovaná ve všech osmi směrech, i pozpátku.',
  cryptogram: 'Doplň slova podle nápověd. Z písmen ve vyznačených políčkách složíš tajenku.',
}

export function puzzleInstructions(puzzle: PuzzleContent): string {
  return puzzle.instructions.trim() || DEFAULT_PUZZLE_INSTRUCTIONS[puzzle.kind]
}

/** Metadata hlavolamu uloženého v databázi. */
export interface PuzzleMeta {
  id: string
  /** Hlavolam vzniká z materiálů tématu a patří k němu. */
  topicId: string | null
  createdAt: string
  updatedAt: string
}

export type Puzzle = PuzzleContent & PuzzleMeta

/** Obsah hlavolamu na snímek do testu — zod zahodí metadata i cokoli navíc. */
export function toPuzzleSnapshot(puzzle: PuzzleContent): PuzzleContent {
  return puzzleContentSchema.parse(puzzle)
}

export function serializePuzzleSnapshot(puzzle: PuzzleContent): string {
  return JSON.stringify(toPuzzleSnapshot(puzzle))
}

/**
 * Snímek hlavolamu z uloženého JSON. Poškozený snímek vrací `null` — test se
 * kvůli jedné položce nesmí rozsypat, volající sáhne po živém hlavolamu.
 */
export function parsePuzzleSnapshot(raw: string | null | undefined): PuzzleContent | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = puzzleContentSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}
