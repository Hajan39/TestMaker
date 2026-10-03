'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Sparkles } from 'lucide-react'
import {
  buildPuzzle,
  puzzleContentSchema,
  puzzleProblems,
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  PUZZLE_CLUE_MAX,
  PUZZLE_ENTRIES_MAX,
  PUZZLE_ENTRIES_MIN,
  PUZZLE_KINDS,
  PUZZLE_PHRASE_MAX,
  PUZZLE_WORD_MAX,
  type PuzzleContent,
  type PuzzleKind,
  type TemplateConfig,
} from '@testmaker/core'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  BusyButton,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
  EmptyState,
  Input,
  Label,
  LoadingLines,
  PaperPuzzle,
  PaperSheet,
  printPdf,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@testmaker/ui'
import { useCanEdit } from '@/components/Permissions'
import { RowActions } from '@/components/RowActions'
import type { PuzzleListItem, PuzzleTopic } from '@/lib/puzzles'
import { errorMessage, requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'
import { formatDate } from '@testmaker/core/dates'

/** A puzzle as the API returns it after saving. */
type PuzzleListRow = PuzzleContent & { id: string; topicId: string | null; updatedAt: string }

/** A word as the API returns it — a word search may lack the clue. */
type ApiEntry = { word: string; clue?: string | null }

/** How many words to ask the model for when the teacher does not choose otherwise. */
const DEFAULT_WORD_COUNT = 12

/**
 * Limits from the puzzle schema (`packages/core/src/schema/puzzle.ts`) and the
 * words API. The UI checks them before the puzzle is sent to the server, so the
 * teacher sees next to the row what to fix instead of a generic "invalid data".
 */
const MIN_WORDS = PUZZLE_ENTRIES_MIN
const MAX_WORDS = PUZZLE_ENTRIES_MAX
const MAX_WORD_LENGTH = PUZZLE_WORD_MAX
const MAX_CLUE_LENGTH = PUZZLE_CLUE_MAX
const MAX_TITLE_LENGTH = 200
const MAX_INSTRUCTIONS_LENGTH = 500
const MAX_PHRASE_LENGTH = PUZZLE_PHRASE_MAX

/**
 * Does the schema require a clue for a word search? Found out from the schema
 * itself, not hard-coded: once core lets the word search go without a clue,
 * the UI stops requiring it. Both an omitted and an empty clue are tried.
 */
const WORDSEARCH_BLANK_CLUE: 'omit' | 'empty' | null = (() => {
  const sample = (clue: Record<string, string>) => ({
    kind: 'wordsearch',
    title: 'x',
    instructions: '',
    entries: [
      { word: 'ab', ...clue },
      { word: 'cd', ...clue },
    ],
    payload: { cols: MIN_GRID_SIZE, rows: MIN_GRID_SIZE, seed: '1', showClues: false },
  })
  if (puzzleContentSchema.safeParse(sample({})).success) return 'omit'
  if (puzzleContentSchema.safeParse(sample({ clue: '' })).success) return 'empty'
  return null
})()

interface DraftEntry {
  word: string
  clue: string
}

interface Draft {
  /** Id of the saved puzzle; `null` for an unsaved one. */
  id: string | null
  kind: PuzzleKind
  title: string
  instructions: string
  topicId: string | null
  entries: DraftEntry[]
  /** Dimensions as text: the field may be cleared and retyped, the limits are enforced on blur. */
  cols: string
  rows: string
  phrase: string
  seed: string
  showClues: boolean
}

function emptyDraft(): Draft {
  return {
    id: null,
    kind: 'wordsearch',
    title: '',
    instructions: '',
    topicId: null,
    entries: [],
    cols: '12',
    rows: '12',
    phrase: '',
    seed: newSeed(),
    showClues: false,
  }
}

/** Fingerprint of the draft — tells an unsaved change apart. */
function draftKey(draft: Draft): string {
  return JSON.stringify(draft)
}

/** A new grid seed — short so it can be copied and read out. */
function newSeed(): string {
  return Math.random().toString(36).slice(2, 8)
}

/** A whole number from a field; `null` when there is no number. */
function parseWhole(text: string): number | null {
  const value = Number(text.trim())
  return text.trim() !== '' && Number.isInteger(value) ? value : null
}

function gridPatch(field: 'cols' | 'rows', value: string): Partial<Draft> {
  return field === 'cols' ? { cols: value } : { rows: value }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** A problem with one row; `muted` only warns, `danger` blocks saving. */
interface RowProblem {
  level: 'muted' | 'danger'
  message: string
}

interface DraftCheck {
  /** Content for the preview — from the valid rows, with a fallback title. */
  preview: PuzzleContent | null
  /** Content to save; `null` while something blocks saving. */
  content: PuzzleContent | null
  rowProblems: (RowProblem | null)[]
  /** What is still missing before saving, with advice. */
  missing: string[]
}

function checkRow(kind: PuzzleKind, entry: DraftEntry): RowProblem | null {
  const word = entry.word.trim()
  const clue = entry.clue.trim()
  if (!word && !clue) {
    return { level: 'muted', message: t('puzzles:workshop.rows.empty') }
  }
  if (!word) return { level: 'danger', message: t('puzzles:workshop.rows.wordMissing') }
  if (word.length < 2) return { level: 'danger', message: t('puzzles:workshop.rows.wordTooShort') }
  if (word.length > MAX_WORD_LENGTH) {
    return {
      level: 'danger',
      message: t('puzzles:workshop.rows.wordTooLong', { length: word.length, max: MAX_WORD_LENGTH }),
    }
  }
  if (clue.length > MAX_CLUE_LENGTH) {
    return {
      level: 'danger',
      message: t('puzzles:workshop.rows.clueTooLong', { length: clue.length, max: MAX_CLUE_LENGTH }),
    }
  }
  if (kind === 'cryptogram' && clue.length < 2) {
    return { level: 'danger', message: t('puzzles:workshop.rows.clueRequired') }
  }
  if (kind === 'wordsearch' && clue.length === 1) {
    return { level: 'danger', message: t('puzzles:workshop.rows.clueTooShort') }
  }
  if (kind === 'wordsearch' && clue.length === 0 && WORDSEARCH_BLANK_CLUE === null) {
    return { level: 'danger', message: t('puzzles:workshop.rows.clueMissing') }
  }
  return null
}

/**
 * The draft in the schema's shape. No row is dropped silently: whatever does
 * not make it into the puzzle says why right next to it.
 */
function checkDraft(draft: Draft): DraftCheck {
  const rowProblems = draft.entries.map((entry) => checkRow(draft.kind, entry))
  const missing: string[] = []

  const usable = draft.entries.filter((_, index) => rowProblems[index] === null)
  const filled = draft.entries.filter((_, index) => rowProblems[index]?.level !== 'muted')
  const broken = rowProblems.filter((problem) => problem?.level === 'danger').length

  if (broken > 0) missing.push(t('puzzles:workshop.missing.brokenRows', { count: broken }))
  if (usable.length < MIN_WORDS) missing.push(t('puzzles:workshop.missing.tooFewWords'))
  if (filled.length > MAX_WORDS) {
    missing.push(
      t('puzzles:workshop.missing.tooManyWords', {
        max: MAX_WORDS,
        remove: t('puzzles:words', { count: filled.length - MAX_WORDS }),
      }),
    )
  }

  const cols = parseWhole(draft.cols)
  const rows = parseWhole(draft.rows)
  if (draft.kind === 'wordsearch') {
    if (cols === null || cols < MIN_GRID_SIZE || cols > MAX_GRID_SIZE) {
      missing.push(t('puzzles:workshop.missing.cols', { min: MIN_GRID_SIZE, max: MAX_GRID_SIZE }))
    }
    if (rows === null || rows < MIN_GRID_SIZE || rows > MAX_GRID_SIZE) {
      missing.push(t('puzzles:workshop.missing.rows', { min: MIN_GRID_SIZE, max: MAX_GRID_SIZE }))
    }
  } else {
    const phrase = draft.phrase.trim()
    if (phrase.length < 2) missing.push(t('puzzles:workshop.missing.phraseMissing'))
    if (phrase.length > MAX_PHRASE_LENGTH) {
      missing.push(t('puzzles:workshop.missing.phraseTooLong', { max: MAX_PHRASE_LENGTH }))
    }
  }
  if (draft.instructions.length > MAX_INSTRUCTIONS_LENGTH) {
    missing.push(t('puzzles:workshop.missing.instructionsTooLong', { max: MAX_INSTRUCTIONS_LENGTH }))
  }

  const title = draft.title.trim()
  if (title.length > MAX_TITLE_LENGTH) missing.push(t('puzzles:workshop.missing.titleTooLong', { max: MAX_TITLE_LENGTH }))

  const previewable = missing.length === 0 || (broken > 0 && missing.length === 1 && usable.length >= MIN_WORDS)
  const parsed = previewable
    ? puzzleContentSchema.safeParse({
        kind: draft.kind,
        title: title || t('puzzles:workshop.untitled'),
        instructions: draft.instructions,
        entries: usable.map((entry) => {
          const word = entry.word.trim()
          const clue = entry.clue.trim()
          if (clue || draft.kind !== 'wordsearch') return { word, clue }
          return WORDSEARCH_BLANK_CLUE === 'omit' ? { word } : { word, clue: '' }
        }),
        payload:
          draft.kind === 'wordsearch'
            ? { cols, rows, seed: draft.seed, showClues: draft.showClues }
            : { phrase: draft.phrase.trim(), seed: draft.seed },
      })
    : null
  if (parsed && !parsed.success) {
    // Safety net: this should never be reached, the limits above mirror the schema.
    missing.push(t('puzzles:workshop.missing.unbuildable'))
  }
  const preview = parsed?.success ? parsed.data : null

  if (!title) missing.push(t('puzzles:workshop.missing.title'))
  const content = preview && missing.length === 0 ? { ...preview, title } : null
  return { preview, content, rowProblems, missing }
}

/** A number from the response — directly or in a `counts` object; the server need not send it yet. */
function countFrom(data: Record<string, unknown>, ...names: string[]): number | null {
  const counts = (typeof data.counts === 'object' && data.counts ? data.counts : {}) as Record<string, unknown>
  for (const name of names) {
    for (const source of [data, counts]) {
      const value = source[name]
      if (typeof value === 'number' && Number.isFinite(value)) return value
    }
  }
  return null
}

/** Search ignoring case and diacritics. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('cs')
}

interface TestOption {
  id: string
  title: string
  updatedAt?: string
  mine?: boolean | number
}

interface Confirmation {
  title: string
  description: string
  confirmLabel: string
  /** What the button says while the action runs. */
  busyLabel: string
  destructive?: boolean
  run: () => Promise<void> | void
}

/**
 * Puzzle workshop: pick a topic, have words extracted, edit the list, choose
 * the grid size or the hidden phrase, see the preview and print.
 *
 * The preview comes from the same computation as the paper (`buildPuzzle` in
 * core), so the screen and the print can never drift apart.
 */
export function PuzzleWorkshop({
  topics,
  puzzles,
  templateConfig,
  aiConfigured,
}: {
  topics: PuzzleTopic[]
  puzzles: PuzzleListItem[]
  templateConfig: TemplateConfig | null
  aiConfigured: boolean
}) {
  const router = useRouter()
  const canEdit = useCanEdit()
  const [start] = useState(emptyDraft)
  const [draft, setDraft] = useState<Draft>(start)
  /** Fingerprint of the last saved (or opened) state. */
  const [baseline, setBaseline] = useState(() => draftKey(start))
  const [wordCount, setWordCount] = useState(String(DEFAULT_WORD_COUNT))
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [printing, setPrinting] = useState<'plain' | 'key' | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [solved, setSolved] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  /** Tests to add the puzzle to; loaded only once the teacher asks for them. */
  const [tests, setTests] = useState<TestOption[] | 'loading' | null>(null)
  const [testsSearch, setTestsSearch] = useState('')
  const [enqueueing, setEnqueueing] = useState<string | null>(null)
  /**
   * Just saved and just deleted puzzles are kept by the browser: `router.refresh()`
   * arrives with a delay and the teacher must see right away that saving worked.
   * Once the refreshed list from the server arrives, both lists simply overlay
   * it — that is why it is composed during render, not in an effect.
   */
  const [saved, setSaved] = useState<PuzzleListItem[]>([])
  const [deleted, setDeleted] = useState<string[]>([])
  const list = useMemo(() => {
    const byId = new Map<string, PuzzleListItem>()
    for (const item of [...saved, ...puzzles]) if (!byId.has(item.id)) byId.set(item.id, item)
    return [...byId.values()].filter((item) => !deleted.includes(item.id))
  }, [puzzles, saved, deleted])

  const check = useMemo(() => checkDraft(draft), [draft])
  const { content, preview, rowProblems, missing } = check
  const built = useMemo(() => (preview ? buildPuzzle(preview) : null), [preview])
  const problems = built ? puzzleProblems(built) : []
  const dirty = draftKey(draft) !== baseline

  /** Why printing and adding are not possible yet; `null` = they are. */
  const blockedReason = !content
    ? t('puzzles:workshop.blocked.unfinished')
    : problems.length > 0
      ? t('puzzles:workshop.blocked.problems')
      : null

  // Unsaved changes are not lost without a warning when the tab closes.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))

  /** Replaces the draft with another one and takes it as the saved state. */
  function resetTo(next: Draft): void {
    setDraft(next)
    setBaseline(draftKey(next))
  }

  /** Asks whether to discard unsaved changes; without changes it proceeds right away. */
  function unlessDirty(action: string, run: () => Promise<void> | void): void {
    if (!dirty) {
      void run()
      return
    }
    setConfirmation({
      title: t('puzzles:workshop.discard.title'),
      description: t('puzzles:workshop.discard.description', { action }),
      confirmLabel: t('puzzles:workshop.discard.confirm'),
      busyLabel: t('puzzles:workshop.discard.busy'),
      destructive: true,
      run,
    })
  }

  function updateEntry(index: number, patch: Partial<DraftEntry>): void {
    setDraft((current) => ({
      ...current,
      entries: current.entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    }))
  }

  function removeEntry(index: number): void {
    setDraft((current) => ({ ...current, entries: current.entries.filter((_, i) => i !== index) }))
  }

  const filledCount = draft.entries.filter((entry) => entry.word.trim() || entry.clue.trim()).length
  /** How many more words fit — a puzzle has at most 40. */
  const roomLeft = MAX_WORDS - filledCount
  const maxRequest = Math.max(MIN_WORDS, Math.min(MAX_WORDS, roomLeft))

  /** Words from the model. The grid is built by code, the model only supplies vocabulary. */
  async function fetchWords(): Promise<void> {
    if (!draft.topicId) {
      toast.error(t('puzzles:workshop.fetch.noTopic'))
      return
    }
    if (roomLeft < MIN_WORDS) {
      toast.error(t('puzzles:workshop.fetch.listFull', { max: MAX_WORDS }))
      return
    }
    const count = clamp(parseWhole(wordCount) ?? DEFAULT_WORD_COUNT, MIN_WORDS, maxRequest)
    setWordCount(String(count))
    setFetching(true)
    try {
      const data = (await requestJson<Record<string, unknown>>(
        '/api/puzzles/words',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            topicId: draft.topicId,
            kind: draft.kind,
            count,
            avoid: draft.entries
              .map((entry) => entry.word.trim())
              .filter(Boolean)
              .slice(0, MAX_WORDS),
            // A cryptogram needs words with the letters of its phrase, a word
            // search words that fit the grid — the server checks both by these fields.
            ...(draft.kind === 'cryptogram'
              ? draft.phrase.trim()
                ? { phrase: draft.phrase.trim().slice(0, MAX_PHRASE_LENGTH) }
                : {}
              : {
                  ...(parseWhole(draft.cols) !== null ? { cols: parseWhole(draft.cols) } : {}),
                  ...(parseWhole(draft.rows) !== null ? { rows: parseWhole(draft.rows) } : {}),
                }),
          }),
        },
        t('puzzles:workshop.fetch.failed'),
      )) as Record<string, unknown>

      const entries = (Array.isArray(data.entries) ? (data.entries as ApiEntry[]) : []).map((entry) => ({
        word: entry.word ?? '',
        clue: entry.clue ?? '',
      }))
      const rejected = Array.isArray(data.rejected) ? (data.rejected as { word: string; reason: string }[]) : []
      const requested = countFrom(data, 'requested', 'requestedCount') ?? count
      const dropped = countFrom(data, 'dropped', 'droppedCount') ?? rejected.length

      setDraft((current) => ({ ...current, entries: [...current.entries, ...entries] }))

      const rejectedNote = rejected.length
        ? t('puzzles:workshop.fetch.rejected', {
            list: rejected.map((item) => `${item.word} (${item.reason})`).join(', '),
          })
        : dropped > 0
          ? t('puzzles:workshop.fetch.dropped', { count: dropped })
          : ''
      const added = t('puzzles:words', { count: entries.length })
      if (entries.length === 0) {
        toast.warning(t('puzzles:workshop.fetch.none'), {
          testId: 'toast-puzzle-no-words',
          description: t('puzzles:workshop.fetch.noneHint', { note: rejectedNote }).trim(),
        })
      } else if (entries.length < requested / 2) {
        toast.warning(t('puzzles:workshop.fetch.fewAdded', { added, requested }), {
          testId: 'toast-puzzle-few-added',
          description: t('puzzles:workshop.fetch.fewAddedHint', { note: rejectedNote }).trim(),
        })
      } else if (typeof data.warning === 'string' && data.warning) {
        // The server knows more than the counts — e.g. that the cryptogram still lacks letters.
        toast.warning(t('puzzles:workshop.fetch.added', { added }), {
          description: `${data.warning} ${rejectedNote}`.trim(),
        })
      } else {
        toast.success(t('puzzles:workshop.fetch.added', { added }), { description: rejectedNote || undefined })
      }
    } catch (error) {
      toast.error(errorMessage(error, t('puzzles:workshop.fetch.failed')))
    } finally {
      setFetching(false)
    }
  }

  /**
   * Saves the puzzle and returns its id. A broken puzzle (a word did not fit…)
   * may be saved as a draft, it is just said out loud.
   */
  async function save(options: { quiet?: boolean } = {}): Promise<string | null> {
    if (!content) {
      toast.error(missing[0] ?? t('puzzles:workshop.save.unfinished'))
      return null
    }
    const snapshot = draft
    setSaving(true)
    try {
      const data = await requestJson<{ puzzle: PuzzleListRow }>(
        snapshot.id ? `/api/puzzles/${snapshot.id}` : '/api/puzzles',
        {
          method: snapshot.id ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ puzzle: content, topicId: snapshot.topicId }),
        },
        t('puzzles:workshop.save.failed'),
      )
      if (!data.puzzle) throw new Error(`${t('puzzles:workshop.save.failed')} ${t('common:errors.serverTrouble')}`)

      const saved = data.puzzle
      const savedDraft = { ...snapshot, id: saved.id }
      setDraft((current) => ({ ...current, id: saved.id }))
      setBaseline(draftKey(savedDraft))
      const row: PuzzleListItem = {
        id: saved.id,
        kind: saved.kind,
        title: saved.title,
        topicId: saved.topicId,
        topicName: topics.find((topic) => topic.id === saved.topicId)?.label ?? null,
        entryCount: saved.entries.length,
        updatedAt: saved.updatedAt,
      }
      setSaved((current) => [row, ...current.filter((item) => item.id !== row.id)])
      router.refresh()
      if (problems.length > 0) {
        toast.warning(t('puzzles:workshop.save.savedUnprintable'), {
          testId: 'toast-puzzle-saved-unprintable',
          description: problems[0]?.message,
        })
      } else if (!options.quiet) {
        toast.success(t('puzzles:workshop.save.saved', { title: saved.title }))
      }
      return saved.id
    } catch (error) {
      toast.error(errorMessage(error, t('puzzles:workshop.save.failed')))
      return null
    } finally {
      setSaving(false)
    }
  }

  /** The saved id; unsaved changes are saved first. */
  async function savedId(): Promise<string | null> {
    if (draft.id && !dirty) return draft.id
    return save({ quiet: true })
  }

  /** Printing always goes from the saved puzzle, so the paper matches the library. */
  async function print(withKey: boolean): Promise<void> {
    if (blockedReason) {
      toast.error(blockedReason)
      return
    }
    setPrinting(withKey ? 'key' : 'plain')
    try {
      const wasDirty = dirty || !draft.id
      const id = await savedId()
      if (!id) return
      if (wasDirty) toast.success(t('puzzles:workshop.print.savedAndPrinting'))
      await printPdf(`/api/puzzles/${id}/pdf${withKey ? '?key=1' : ''}`)
    } catch (error) {
      toast.error(errorMessage(error, t('puzzles:workshop.print.failed')))
    } finally {
      setPrinting(null)
    }
  }

  /** Opens the choice of own tests; saving happens only after the choice. */
  async function chooseTest(): Promise<void> {
    if (blockedReason) {
      toast.error(blockedReason)
      return
    }
    setTestsSearch('')
    setTests('loading')
    try {
      const data = await requestJson<{ tests: TestOption[] }>('/api/tests', undefined, t('puzzles:workshop.tests.loadFailed'))
      // Only own tests can be added to; tests shared by colleagues are read-only.
      setTests((data.tests ?? []).filter((test) => test.mine === undefined || Boolean(test.mine)))
    } catch (error) {
      setTests(null)
      toast.error(errorMessage(error, t('puzzles:workshop.tests.loadFailed')))
    }
  }

  /** Adds the puzzle to the end of the chosen test; unsaved changes are saved. */
  async function addToTest(testId: string): Promise<void> {
    setEnqueueing(testId)
    try {
      const id = await savedId()
      if (!id) return
      const data = await requestJson<{ testTitle: string }>(
        `/api/puzzles/${id}/to-test`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ testId }),
        },
        t('puzzles:workshop.tests.addFailed'),
      )
      setTests(null)
      toast.success(t('puzzles:workshop.tests.added', { title: data.testTitle ?? '' }))
    } catch (error) {
      toast.error(errorMessage(error, t('puzzles:workshop.tests.addFailed')))
    } finally {
      setEnqueueing(null)
    }
  }

  async function openPuzzle(id: string): Promise<void> {
    setOpening(id)
    try {
      const { puzzle } = await requestJson<{
        puzzle: PuzzleContent & { id: string; topicId: string | null }
      }>(`/api/puzzles/${id}`, undefined, t('puzzles:workshop.open.failed'))
      if (!puzzle) throw new Error(`${t('puzzles:workshop.open.failed')} ${t('common:errors.serverTrouble')}`)
      resetTo({
        id: puzzle.id,
        kind: puzzle.kind,
        title: puzzle.title,
        instructions: puzzle.instructions,
        topicId: puzzle.topicId,
        entries: (puzzle.entries as ApiEntry[]).map((entry) => ({ word: entry.word, clue: entry.clue ?? '' })),
        cols: String(puzzle.kind === 'wordsearch' ? puzzle.payload.cols : 12),
        rows: String(puzzle.kind === 'wordsearch' ? puzzle.payload.rows : 12),
        showClues: puzzle.kind === 'wordsearch' ? puzzle.payload.showClues : false,
        phrase: puzzle.kind === 'cryptogram' ? puzzle.payload.phrase : '',
        seed: puzzle.payload.seed,
      })
    } catch (error) {
      toast.error(errorMessage(error, t('puzzles:workshop.open.failed')))
    } finally {
      setOpening(null)
    }
  }

  async function removePuzzle(id: string, title: string): Promise<void> {
    try {
      await requestJson(`/api/puzzles/${id}`, { method: 'DELETE' }, t('puzzles:workshop.remove.failed'))
    } catch (error) {
      toast.error(errorMessage(error, t('puzzles:workshop.remove.failed')))
      return
    }
    if (draft.id === id) resetTo(emptyDraft())
    setDeleted((current) => [...current, id])
    setSaved((current) => current.filter((item) => item.id !== id))
    toast.success(t('puzzles:workshop.remove.done', { title }))
    router.refresh()
  }

  function askRemove(id: string, title: string): void {
    setConfirmation({
      title: t('puzzles:workshop.remove.confirmTitle', { title }),
      description: t('puzzles:workshop.remove.confirmDescription'),
      confirmLabel: t('puzzles:workshop.remove.confirm'),
      busyLabel: t('common:actions.deleting'),
      destructive: true,
      run: () => removePuzzle(id, title),
    })
  }

  async function runConfirmation(): Promise<void> {
    if (!confirmation) return
    setConfirmBusy(true)
    try {
      await confirmation.run()
      setConfirmation(null)
    } finally {
      setConfirmBusy(false)
    }
  }

  const search = fold(testsSearch.trim())
  const foundTests =
    Array.isArray(tests) && search ? tests.filter((test) => fold(test.title).includes(search)) : tests
  const titleMissing = t('puzzles:workshop.missing.title')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">{t('puzzles:workshop.title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-soft">{t('puzzles:workshop.intro')}</p>
          {canEdit ? null : (
            <p className="mt-1 max-w-3xl text-sm text-fg-muted" data-slot="puzzle-read-only">
              {t('puzzles:workshop.readOnly')}
            </p>
          )}
        </div>
        {/* The saved list sits below the workshop; on a phone nobody would dig down to it. */}
        <a href="#ulozene-hlavolamy" className="text-sm text-fg-soft underline-offset-2 hover:underline">
          {t('puzzles:workshop.inLibrary', { count: list.length })}
        </a>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4" aria-busy={opening !== null || undefined}>
          {opening ? (
            <p className="text-sm text-fg-muted" role="status" data-slot="puzzle-opening">
              {t('puzzles:workshop.opening')}
            </p>
          ) : null}
          {/* Read-only viewers read and print puzzles but never change them — all fields are locked at once. */}
          <fieldset disabled={!canEdit} className="contents">
          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap gap-3">
              <div className="w-48">
                <Label htmlFor="puzzle-kind">{t('puzzles:workshop.form.kind')}</Label>
                <Select value={draft.kind} onValueChange={(value) => update({ kind: value as PuzzleKind })}>
                  <SelectTrigger id="puzzle-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PUZZLE_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {t(`puzzles:kinds.${kind}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-56 flex-1">
                <Label htmlFor="puzzle-title">{t('puzzles:workshop.form.title')}</Label>
                <Input
                  id="puzzle-title"
                  value={draft.title}
                  maxLength={MAX_TITLE_LENGTH}
                  placeholder={t('puzzles:workshop.form.titlePlaceholder')}
                  aria-describedby="puzzle-title-hint"
                  onChange={(event) => update({ title: event.target.value })}
                />
                <p id="puzzle-title-hint" className="mt-1 text-xs text-fg-muted">
                  {t('puzzles:workshop.form.titleHint')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="min-w-56 flex-1">
                <Label htmlFor="puzzle-topic">{t('puzzles:workshop.form.topic')}</Label>
                <Select
                  value={draft.topicId ?? 'none'}
                  onValueChange={(value) => {
                    const topicId = value === 'none' ? null : value
                    update({ topicId })
                    if (topicId && draft.entries.length === 0) {
                      // The words last extracted for the topic; if they fail to load, nothing happens.
                      void fetch(`/api/puzzles/words?topicId=${encodeURIComponent(topicId)}&kind=${draft.kind}`)
                        .then((response) => (response.ok ? response.json() : { entries: [] }))
                        .then((data: { entries?: ApiEntry[] }) => {
                          const loaded = data.entries
                          if (!loaded?.length) return
                          // The response arrives late: meanwhile the teacher may have picked
                          // another topic or started typing words — those are not overwritten.
                          setDraft((current) =>
                            current.topicId === topicId && current.entries.length === 0
                              ? {
                                  ...current,
                                  entries: loaded.map((entry) => ({ word: entry.word, clue: entry.clue ?? '' })),
                                }
                              : current,
                          )
                        })
                        .catch(() => undefined)
                    }
                  }}
                >
                  <SelectTrigger id="puzzle-topic">
                    <SelectValue placeholder={t('puzzles:workshop.form.noTopic')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('puzzles:workshop.form.noTopic')}</SelectItem>
                    {topics.map((topic) => (
                      <SelectItem key={topic.id} value={topic.id}>
                        {topic.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {aiConfigured ? (
                <>
                  <div className="w-32">
                    <Label htmlFor="puzzle-word-count">{t('puzzles:workshop.form.wordCount')}</Label>
                    <Input
                      id="puzzle-word-count"
                      type="number"
                      inputMode="numeric"
                      min={MIN_WORDS}
                      max={maxRequest}
                      value={wordCount}
                      aria-describedby="puzzle-word-count-hint"
                      onChange={(event) => setWordCount(event.target.value)}
                      onBlur={() =>
                        setWordCount(String(clamp(parseWhole(wordCount) ?? DEFAULT_WORD_COUNT, MIN_WORDS, maxRequest)))
                      }
                    />
                    <p id="puzzle-word-count-hint" className="mt-1 text-xs text-fg-muted">
                      {roomLeft < MIN_WORDS
                        ? t('puzzles:workshop.form.listFull')
                        : t('puzzles:workshop.form.range', { min: MIN_WORDS, max: maxRequest })}
                    </p>
                  </div>
                  <div className="flex items-start pt-5">
                    <BusyButton
                      variant="outline"
                      busy={fetching}
                      busyLabel={t('puzzles:workshop.form.searching')}
                      disabled={roomLeft < MIN_WORDS}
                      onClick={() => void fetchWords()}
                    >
                      <Sparkles className="size-4" />
                      {t('puzzles:workshop.form.fetchWords')}
                    </BusyButton>
                  </div>
                </>
              ) : (
                <p className="max-w-sm self-end text-sm text-fg-muted">{t('puzzles:workshop.form.aiOff')}</p>
              )}
            </div>

            <div>
              <Label htmlFor="puzzle-instructions">{t('puzzles:workshop.form.instructions')}</Label>
              <Textarea
                id="puzzle-instructions"
                value={draft.instructions}
                rows={2}
                maxLength={MAX_INSTRUCTIONS_LENGTH}
                placeholder={t('puzzles:workshop.form.instructionsPlaceholder')}
                onChange={(event) => update({ instructions: event.target.value })}
              />
            </div>

            {draft.kind === 'wordsearch' ? (
              <div className="flex flex-wrap items-start gap-3">
                {(['cols', 'rows'] as const).map((field) => (
                  <div key={field} className="w-24">
                    <Label htmlFor={`puzzle-${field}`}>{t(`puzzles:workshop.form.${field}`)}</Label>
                    <Input
                      id={`puzzle-${field}`}
                      type="number"
                      inputMode="numeric"
                      min={MIN_GRID_SIZE}
                      max={MAX_GRID_SIZE}
                      value={draft[field]}
                      aria-describedby="puzzle-grid-hint"
                      onChange={(event) => update(gridPatch(field, event.target.value))}
                      onBlur={() =>
                        update(
                          gridPatch(field, String(clamp(parseWhole(draft[field]) ?? 12, MIN_GRID_SIZE, MAX_GRID_SIZE))),
                        )
                      }
                    />
                  </div>
                ))}
                <p id="puzzle-grid-hint" className="self-center pt-5 text-xs text-fg-muted">
                  {t('puzzles:workshop.form.range', { min: MIN_GRID_SIZE, max: MAX_GRID_SIZE })}
                </p>
                <div className="pt-5">
                  <Button variant="outline" onClick={() => update({ seed: newSeed() })}>
                    {t('puzzles:workshop.form.reshuffle')}
                  </Button>
                </div>
                <label className="flex items-center gap-2 pt-7 text-sm">
                  <Checkbox
                    checked={draft.showClues}
                    onCheckedChange={(checked) => update({ showClues: checked === true })}
                  />
                  {t('puzzles:workshop.form.showClues')}
                </label>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1">
                  <Label htmlFor="puzzle-phrase">{t('puzzles:workshop.form.phrase')}</Label>
                  <Input
                    id="puzzle-phrase"
                    value={draft.phrase}
                    maxLength={MAX_PHRASE_LENGTH}
                    placeholder={t('puzzles:workshop.form.phrasePlaceholder')}
                    onChange={(event) => update({ phrase: event.target.value })}
                  />
                </div>
                <Button variant="outline" onClick={() => update({ seed: newSeed() })}>
                  {t('puzzles:workshop.form.reshuffle')}
                </Button>
              </div>
            )}
          </Card>
          </fieldset>

          <Card className="p-4">
            <fieldset disabled={!canEdit} className="contents">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium text-fg">
                {t('puzzles:workshop.entries.heading', { words: t('puzzles:words', { count: draft.entries.length }) })}
              </h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => update({ entries: [...draft.entries, { word: '', clue: '' }] })}
              >
                <Plus className="size-4" />
                {t('puzzles:workshop.entries.add')}
              </Button>
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              {draft.kind === 'wordsearch'
                ? WORDSEARCH_BLANK_CLUE
                  ? t('puzzles:workshop.entries.hintWordsearchOptional', { max: MAX_WORD_LENGTH })
                  : t('puzzles:workshop.entries.hintWordsearch', { max: MAX_WORD_LENGTH })
                : t('puzzles:workshop.entries.hintCryptogram', { max: MAX_WORD_LENGTH })}{' '}
              {t('puzzles:workshop.entries.limit', { max: MAX_WORDS })}
            </p>

            {draft.entries.length === 0 ? (
              <p className="mt-3 text-sm text-fg-muted">{t('puzzles:workshop.entries.empty')}</p>
            ) : (
              <ul className="mt-3 space-y-2" data-slot="puzzle-entries">
                {draft.entries.map((entry, index) => {
                  const problem = rowProblems[index]
                  const problemId = `puzzle-entry-problem-${index}`
                  return (
                    <li key={index} data-problem={problem?.level}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          className="w-40"
                          value={entry.word}
                          aria-label={t('puzzles:workshop.entries.word', { number: index + 1 })}
                          aria-invalid={problem?.level === 'danger' || undefined}
                          aria-describedby={problem ? problemId : undefined}
                          onChange={(event) => updateEntry(index, { word: event.target.value })}
                        />
                        <Input
                          className="min-w-48 flex-1"
                          value={entry.clue}
                          aria-label={t('puzzles:workshop.entries.clue', { number: index + 1 })}
                          aria-invalid={problem?.level === 'danger' || undefined}
                          aria-describedby={problem ? problemId : undefined}
                          onChange={(event) => updateEntry(index, { clue: event.target.value })}
                        />
                        <RowActions label={t('puzzles:workshop.entries.actions', { word: entry.word || index + 1 })}>
                          <DropdownMenuItem variant="destructive" onSelect={() => removeEntry(index)}>
                            {t('puzzles:workshop.entries.remove')}
                          </DropdownMenuItem>
                        </RowActions>
                      </div>
                      {problem ? (
                        <p
                          id={problemId}
                          data-slot="puzzle-entry-problem"
                          className={
                            problem.level === 'danger' ? 'mt-1 text-sm text-danger' : 'mt-1 text-sm text-fg-muted'
                          }
                        >
                          {problem.message}
                        </p>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
            </fieldset>

            {problems.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm text-danger" data-slot="puzzle-problems">
                {problems.map((problem, index) => (
                  <li key={index}>{problem.message}</li>
                ))}
              </ul>
            ) : null}

            {missing.length > 0 ? (
              <div className="mt-3 text-sm text-fg-soft" data-slot="puzzle-missing">
                <p className="font-medium">{t('puzzles:workshop.missingHeading')}</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {missing.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {canEdit ? (
                // Disabled even while printing or adding saves — a second click would send a second POST.
                <BusyButton busy={saving} busyLabel={t('common:actions.saving')} onClick={() => void save()}>
                  {draft.id ? t('puzzles:workshop.save.buttonChanges') : t('puzzles:workshop.save.button')}
                </BusyButton>
              ) : null}
              <BusyButton
                variant="outline"
                busy={printing === 'plain'}
                busyLabel={t('puzzles:workshop.print.preparing')}
                disabled={blockedReason !== null || printing !== null || saving || (!canEdit && (!draft.id || dirty))}
                aria-describedby={blockedReason ? 'puzzle-blocked' : undefined}
                onClick={() => void print(false)}
              >
                {t('common:actions.print')}
              </BusyButton>
              <BusyButton
                variant="outline"
                busy={printing === 'key'}
                busyLabel={t('puzzles:workshop.print.preparing')}
                disabled={blockedReason !== null || printing !== null || saving || (!canEdit && (!draft.id || dirty))}
                aria-describedby={blockedReason ? 'puzzle-blocked' : undefined}
                onClick={() => void print(true)}
              >
                {t('puzzles:workshop.print.withKey')}
              </BusyButton>
              {canEdit ? (
                <Button
                  variant="outline"
                  disabled={blockedReason !== null || saving}
                  aria-describedby={blockedReason ? 'puzzle-blocked' : undefined}
                  onClick={() => void chooseTest()}
                >
                  {t('puzzles:workshop.tests.button')}
                </Button>
              ) : null}
              {draft.id || dirty ? (
                <Button
                  variant="ghost"
                  onClick={() => unlessDirty(t('puzzles:workshop.discard.actionNew'), () => resetTo(emptyDraft()))}
                >
                  {t('puzzles:workshop.newPuzzle')}
                </Button>
              ) : null}
            </div>
            {blockedReason ? (
              <p id="puzzle-blocked" className="mt-2 text-sm text-fg-muted" data-slot="puzzle-blocked">
                {blockedReason}
              </p>
            ) : dirty && draft.id ? (
              <p className="mt-2 text-sm text-fg-muted">{t('puzzles:workshop.unsaved')}</p>
            ) : null}
          </Card>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium text-fg">{t('puzzles:workshop.preview.heading')}</h2>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={solved} onCheckedChange={(checked) => setSolved(checked === true)} />
              {t('puzzles:workshop.preview.showSolution')}
            </label>
          </div>

          {opening ? (
            <LoadingLines lines={6} />
          ) : preview && templateConfig ? (
            <PaperSheet config={templateConfig}>
              <PaperPuzzle puzzle={preview} built={built ?? undefined} solved={solved} />
            </PaperSheet>
          ) : (
            <EmptyState
              title={t('puzzles:workshop.preview.emptyTitle')}
              hint={
                !templateConfig
                  ? t('puzzles:workshop.preview.noTemplate')
                  : (missing.find((message) => message !== titleMissing) ??
                    t('puzzles:workshop.preview.needWords'))
              }
            />
          )}
        </div>
      </div>

      <Dialog open={tests !== null} onOpenChange={(open) => (open ? null : setTests(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('puzzles:workshop.tests.dialogTitle')}</DialogTitle>
            <DialogDescription>
              {t('puzzles:workshop.tests.dialogDescription')}
              {dirty || !draft.id ? ` ${t('puzzles:workshop.tests.dialogUnsaved')}` : ''}
            </DialogDescription>
          </DialogHeader>
          {tests === 'loading' ? (
            <LoadingLines lines={4} />
          ) : tests && tests.length > 0 ? (
            <>
              <Input
                type="search"
                value={testsSearch}
                placeholder={t('puzzles:workshop.tests.searchPlaceholder')}
                aria-label={t('puzzles:workshop.tests.searchLabel')}
                onChange={(event) => setTestsSearch(event.target.value)}
              />
              {foundTests && Array.isArray(foundTests) && foundTests.length > 0 ? (
                <ul className="max-h-80 divide-y divide-line overflow-y-auto" data-slot="puzzle-test-list">
                  {foundTests.map((test) => (
                    <li key={test.id}>
                      <button
                        type="button"
                        disabled={enqueueing !== null || saving}
                        className="flex w-full items-baseline justify-between gap-3 py-2 text-left text-sm text-fg hover:underline disabled:opacity-60"
                        onClick={() => void addToTest(test.id)}
                      >
                        <span className="min-w-0 flex-1">
                          {enqueueing === test.id ? t('puzzles:workshop.tests.adding') : test.title}
                        </span>
                        {test.updatedAt ? (
                          <span className="shrink-0 text-xs text-fg-muted">
                            {formatDate(test.updatedAt)}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-muted">{t('puzzles:workshop.tests.noMatch')}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-fg-muted">{t('puzzles:workshop.tests.none')}</p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => (open || confirmBusy ? null : setConfirmation(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmBusy}>{t('puzzles:workshop.keepIt')}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmation?.destructive ? 'destructive' : 'default'}
              disabled={confirmBusy}
              onClick={(event) => {
                // The dialog closes only once the action finishes, so it is visible that it runs.
                event.preventDefault()
                void runConfirmation()
              }}
            >
              {confirmBusy ? confirmation?.busyLabel : confirmation?.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="scroll-mt-4 p-4" id="ulozene-hlavolamy">
        <h2 className="font-medium text-fg">{t('puzzles:workshop.saved.heading')}</h2>
        {list.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">{t('puzzles:workshop.saved.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-line" data-slot="puzzle-list">
            {list.map((puzzle) => (
              <li key={puzzle.id} className="flex flex-wrap items-center gap-2 py-2">
                <button
                  type="button"
                  disabled={opening !== null}
                  className="min-w-0 flex-1 text-left text-sm text-fg hover:underline disabled:opacity-60"
                  onClick={() => unlessDirty(t('puzzles:workshop.discard.actionOpen'), () => openPuzzle(puzzle.id))}
                >
                  {opening === puzzle.id ? t('puzzles:workshop.openingShort') : puzzle.title}
                </button>
                <Badge variant="secondary">{t(`puzzles:kinds.${puzzle.kind}`)}</Badge>
                <span className="text-sm text-fg-muted">
                  {puzzle.topicName ?? t('puzzles:workshop.saved.noTopic')} ·{' '}
                  {t('puzzles:words', { count: puzzle.entryCount })}
                </span>
                <RowActions label={t('puzzles:workshop.saved.actions', { title: puzzle.title })}>
                  <DropdownMenuItem
                    onSelect={() => unlessDirty(t('puzzles:workshop.discard.actionOpen'), () => openPuzzle(puzzle.id))}
                  >
                    {t('common:actions.open')}
                  </DropdownMenuItem>
                  {canEdit ? (
                    <DropdownMenuItem variant="destructive" onSelect={() => askRemove(puzzle.id, puzzle.title)}>
                      {t('common:actions.delete')}
                    </DropdownMenuItem>
                  ) : null}
                </RowActions>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
