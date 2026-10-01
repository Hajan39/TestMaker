import { z } from 'zod'
import { t } from '../i18n'

/**
 * Puzzle — word search and cryptogram.
 *
 * The input is always a word + clue pair, never raw text: the grid is built
 * by code (see `packages/core/src/puzzle`), the model only supplies the
 * vocabulary. The puzzle shape has a single definition here, just like the
 * question — the database, the model and rendering all follow this schema.
 */

export const PUZZLE_KINDS = ['wordsearch', 'cryptogram'] as const
export type PuzzleKind = (typeof PUZZLE_KINDS)[number]

/** Name of the puzzle kind shown to the teacher (and used in model prompts). */
export function puzzleKindLabel(kind: PuzzleKind): string {
  return t(`core:puzzleKinds.${kind}`)
}

/**
 * Puzzle input limits. Exported as constants so that the model prompt and the
 * workshop form stick to them too — anything longer the model or the teacher
 * writes is rejected by the schema anyway.
 */
export const PUZZLE_WORD_MIN = 2
export const PUZZLE_WORD_MAX = 24
/** Shortest clue where a clue is required (cryptogram). */
export const PUZZLE_CLUE_MIN = 2
export const PUZZLE_CLUE_MAX = 200
export const PUZZLE_ENTRIES_MIN = 2
export const PUZZLE_ENTRIES_MAX = 40
export const PUZZLE_PHRASE_MIN = 2
export const PUZZLE_PHRASE_MAX = 120

/**
 * Puzzle word with the clue the pupil gets on paper.
 *
 * The clue is optional here (missing = empty): a word search prints words and
 * clues only on request, so a word without a clue must not be dropped. A
 * cryptogram cannot be solved without clues — it uses the stricter
 * `cryptogramEntrySchema`.
 */
export const puzzleEntrySchema = z.object({
  word: z.string().min(PUZZLE_WORD_MIN).max(PUZZLE_WORD_MAX),
  /** Short school clue; in a word search printed only on request. */
  clue: z.string().max(PUZZLE_CLUE_MAX).default(''),
})

/** Cryptogram word — the clue is required, the pupil fills in the word from it. */
export const cryptogramEntrySchema = puzzleEntrySchema.extend({
  clue: z.string().min(PUZZLE_CLUE_MIN).max(PUZZLE_CLUE_MAX),
})

export type PuzzleEntry = z.infer<typeof puzzleEntrySchema>

/** Word search grid limits — smaller cannot be filled, larger does not fit the page. */
export const MIN_GRID_SIZE = 6
export const MAX_GRID_SIZE = 20

export const wordSearchPayloadSchema = z.object({
  cols: z.number().int().min(MIN_GRID_SIZE).max(MAX_GRID_SIZE).default(12),
  rows: z.number().int().min(MIN_GRID_SIZE).max(MAX_GRID_SIZE).default(12),
  /**
   * Placement is seeded: the same words and the same seed always give the
   * same grid, so the puzzle can be reprinted unchanged a month later.
   */
  seed: z.string().min(1).max(40).default('1'),
  /** List clues below the grid as well, not just the words. */
  showClues: z.boolean().default(false),
})

export const cryptogramPayloadSchema = z.object({
  /** Sentence to be assembled from the marked letters. */
  phrase: z.string().min(PUZZLE_PHRASE_MIN).max(PUZZLE_PHRASE_MAX),
  seed: z.string().min(1).max(40).default('1'),
})

const baseFields = {
  title: z.string().min(1).max(200),
  /** Instruction for the pupil above the puzzle; empty = the default for the kind is used. */
  instructions: z.string().max(500).default(''),
}

export const puzzleContentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('wordsearch'),
    payload: wordSearchPayloadSchema,
    ...baseFields,
    entries: z.array(puzzleEntrySchema).min(PUZZLE_ENTRIES_MIN).max(PUZZLE_ENTRIES_MAX),
  }),
  z.object({
    kind: z.literal('cryptogram'),
    payload: cryptogramPayloadSchema,
    ...baseFields,
    entries: z.array(cryptogramEntrySchema).min(PUZZLE_ENTRIES_MIN).max(PUZZLE_ENTRIES_MAX),
  }),
])

export type PuzzleContent = z.infer<typeof puzzleContentSchema>
export type WordSearchContent = Extract<PuzzleContent, { kind: 'wordsearch' }>
export type CryptogramContent = Extract<PuzzleContent, { kind: 'cryptogram' }>

/** Default instruction for the pupil when the teacher did not write one. */
export function defaultPuzzleInstructions(kind: PuzzleKind): string {
  return t(`core:puzzleInstructions.${kind}`)
}

export function puzzleInstructions(puzzle: PuzzleContent): string {
  return puzzle.instructions.trim() || defaultPuzzleInstructions(puzzle.kind)
}

/** Metadata of a puzzle stored in the database. */
export interface PuzzleMeta {
  id: string
  /** A puzzle is made from the topic's materials and belongs to it. */
  topicId: string | null
  createdAt: string
  updatedAt: string
}

export type Puzzle = PuzzleContent & PuzzleMeta

/** Puzzle content for a test snapshot — zod drops metadata and anything extra. */
export function toPuzzleSnapshot(puzzle: PuzzleContent): PuzzleContent {
  return puzzleContentSchema.parse(puzzle)
}

export function serializePuzzleSnapshot(puzzle: PuzzleContent): string {
  return JSON.stringify(toPuzzleSnapshot(puzzle))
}

/**
 * Puzzle snapshot from stored JSON. A corrupted snapshot returns `null` — the
 * test must not fall apart because of one item; the caller uses the live puzzle.
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
