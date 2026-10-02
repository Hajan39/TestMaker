import type {
  PuzzleContent,
  Question,
  ResolvedTestItem,
  TableItemContent,
  TestHeaderConfig,
  TextItemContent,
} from '@testmaker/core/schema'

/** Points formatting has a single definition — the same one the PDF prints. */
export { formatPoints } from '@testmaker/core/pdf/layout'

/** Item of a test being edited; `key` is only stable in browser memory. */
export interface DraftItem {
  key: string
  /** Id of an already saved item; `null` for newly added ones. */
  id: string | null
  kind: ResolvedTestItem['kind']
  questionId: string | null
  text: string | null
  pointsOverride: number | null
  /** Override of the number of answer lines; empty = per the question. */
  linesOverride: number | null
  question: Question | null
  /** Set on items of kind `puzzle` — a puzzle included in the test. */
  puzzleId: string | null
  /** Puzzle content from the frozen snapshot; read-only, edited in Puzzles. */
  puzzle: PuzzleContent | null
  /** Grid of a worksheet table; `null` for other items and for a broken table. */
  table: TableItemContent | null
  /** Worksheet text variant (text or fun fact); `null` for other items and for broken content. */
  textContent: TextItemContent | null
  /** The "ověř" (verify) flag: content not based on the materials. The teacher clears it, editing does not. */
  needsCheck: boolean
  /** The live question differs from the one frozen in the test. */
  questionEdited?: boolean
  /** The question is no longer in the bank; the test only holds its snapshot. */
  questionMissing?: boolean
  /** Reloaded from the bank; the next save freezes the current version. */
  reloaded?: boolean
}

/** What a worksheet can add on top of a written test. */
export type WorksheetAddKind = 'text' | 'fun_fact' | 'table' | 'question'

/** Item controls only a worksheet has. */
export interface WorksheetControls {
  onAdd: (kind: WorksheetAddKind, index?: number) => void
  /** Opens the worksheet task editor (the result goes into the item snapshot, not the bank). */
  onEditQuestion: (key: string) => void
  /** Regenerating an item; absent without a configured model or for an unsaved worksheet. */
  onRegenerate?: (key: string) => void
  /** Key of the item currently being regenerated. */
  regenerating: string | null
}

/**
 * Bank filters. Question status is not one of them — the bank only ever holds approved ones.
 *
 * `grade` is the `gradeId`, not the name — grades with the same name exist in
 * several subjects and filtering by name could easily hit the wrong one.
 */
export interface BankFilters {
  search: string
  subject: string
  grade: string
  type: string
}

/** Test settings edited in the side panel (Sheet). */
export interface TestSettingsValue {
  title: string
  description: string
  graded: boolean
  templateId: string
  header: TestHeaderConfig
  variants: 1 | 2
  showKey: boolean
  /** `soukrome` is visible only to the author, `skola` also to colleagues. */
  visibility: 'soukrome' | 'skola'
}

/** `key` is only stable in browser memory, so a module-level counter is enough. */
let keyCounter = 0
export const nextDraftKey = (): string => `item-${(keyCounter += 1)}`
