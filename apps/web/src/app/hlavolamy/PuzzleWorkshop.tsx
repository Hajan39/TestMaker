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
  PUZZLE_KIND_LABELS,
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
  pocet,
  printPdf,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
  type PluralForms,
} from '@testmaker/ui'
import { useMuzeMenit } from '@/components/Prava'
import { RowActions } from '@/components/RowActions'
import type { PuzzleListItem, PuzzleTopic } from '@/lib/puzzles'
import { errorMessage, requestJson, SERVER_TROUBLE } from '@/lib/requestJson'

/** Hlavolam tak, jak ho vrací API po uložení. */
type PuzzleListRow = PuzzleContent & { id: string; topicId: string | null; updatedAt: string }

/** Slovo tak, jak ho vrací API — u osmisměrky nápověda chybět smí. */
type ApiEntry = { word: string; clue?: string | null }

const SLOVA: PluralForms = ['slovo', 'slova', 'slov']
const HLAVOLAMY: PluralForms = ['hlavolam', 'hlavolamy', 'hlavolamů']

/** Kolik slov se od modelu žádá, když si učitelka nezvolí jinak. */
const DEFAULT_WORD_COUNT = 12

/**
 * Meze ze schématu hlavolamu (`packages/core/src/schema/puzzle.ts`) a z API
 * slov. Rozhraní je hlídá dřív, než se hlavolam pošle na server, aby
 * učitelka viděla u řádku, co opravit, místo obecného „neplatná data".
 */
const MIN_WORDS = PUZZLE_ENTRIES_MIN
const MAX_WORDS = PUZZLE_ENTRIES_MAX
const MAX_WORD_LENGTH = PUZZLE_WORD_MAX
const MAX_CLUE_LENGTH = PUZZLE_CLUE_MAX
const MAX_TITLE_LENGTH = 200
const MAX_INSTRUCTIONS_LENGTH = 500
const MAX_PHRASE_LENGTH = PUZZLE_PHRASE_MAX

/**
 * Chce schéma u osmisměrky nápovědu? Zjišťuje se ze schématu samého, ne
 * natvrdo: jakmile core nápovědu u osmisměrky pustí, rozhraní ji přestane
 * vyžadovat. Zkouší se vynechaná i prázdná nápověda.
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
  /** Id uloženého hlavolamu; `null` u rozpracovaného. */
  id: string | null
  kind: PuzzleKind
  title: string
  instructions: string
  topicId: string | null
  entries: DraftEntry[]
  /** Rozměry jako text: pole se smí vymazat a přepsat, meze hlídá rozmazání. */
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

/** Otisk rozpracovaného hlavolamu — podle něj se pozná neuložená změna. */
function draftKey(draft: Draft): string {
  return JSON.stringify(draft)
}

/** Nový los mřížky — krátký, aby se dal opsat i přečíst. */
function newSeed(): string {
  return Math.random().toString(36).slice(2, 8)
}

/** Celé číslo z pole; `null`, když tam číslo není. */
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

/** Potíž jednoho řádku; `muted` jen upozorní, `danger` brání uložení. */
interface RowProblem {
  level: 'muted' | 'danger'
  message: string
}

interface DraftCheck {
  /** Obsah pro náhled — z bezchybných řádků, s náhradním názvem. */
  preview: PuzzleContent | null
  /** Obsah k uložení; `null`, dokud něco brání uložení. */
  content: PuzzleContent | null
  rowProblems: (RowProblem | null)[]
  /** Co ještě chybí k uložení, česky a s radou. */
  missing: string[]
}

function checkRow(kind: PuzzleKind, entry: DraftEntry): RowProblem | null {
  const word = entry.word.trim()
  const clue = entry.clue.trim()
  if (!word && !clue) {
    return { level: 'muted', message: 'Prázdný řádek se nepoužije — napiš slovo, nebo řádek odeber.' }
  }
  if (!word) return { level: 'danger', message: 'Doplň slovo k téhle nápovědě.' }
  if (word.length < 2) return { level: 'danger', message: 'Slovo musí mít aspoň 2 znaky.' }
  if (word.length > MAX_WORD_LENGTH) {
    return {
      level: 'danger',
      message: `Slovo má ${word.length} znaků, do hlavolamu se vejde nejvýš ${MAX_WORD_LENGTH}. Zkrať ho.`,
    }
  }
  if (clue.length > MAX_CLUE_LENGTH) {
    return {
      level: 'danger',
      message: `Nápověda má ${clue.length} znaků, nejvýš jich smí být ${MAX_CLUE_LENGTH}. Zkrať ji.`,
    }
  }
  if (kind === 'cryptogram' && clue.length < 2) {
    return { level: 'danger', message: 'Doplň nápovědu — bez ní žák neví, co má do řádku napsat.' }
  }
  if (kind === 'wordsearch' && clue.length === 1) {
    return { level: 'danger', message: 'Nápověda musí mít aspoň 2 znaky, nebo ji nech prázdnou.' }
  }
  if (kind === 'wordsearch' && clue.length === 0 && WORDSEARCH_BLANK_CLUE === null) {
    return { level: 'danger', message: 'Doplň nápovědu (aspoň 2 znaky).' }
  }
  return null
}

/**
 * Rozpracovaný hlavolam na tvar podle schématu. Žádný řádek se nezahazuje
 * potichu: co se do hlavolamu nedostane, má u sebe napsané proč.
 */
function checkDraft(draft: Draft): DraftCheck {
  const rowProblems = draft.entries.map((entry) => checkRow(draft.kind, entry))
  const missing: string[] = []

  const usable = draft.entries.filter((_, index) => rowProblems[index] === null)
  const filled = draft.entries.filter((_, index) => rowProblems[index]?.level !== 'muted')
  const broken = rowProblems.filter((problem) => problem?.level === 'danger').length

  if (broken > 0) {
    missing.push(
      broken === 1 ? 'Oprav řádek označený v seznamu slov.' : `Oprav ${broken} řádky označené v seznamu slov.`,
    )
  }
  if (usable.length < MIN_WORDS) missing.push('Hlavolam potřebuje aspoň dvě slova.')
  if (filled.length > MAX_WORDS) {
    missing.push(`Hlavolam může mít nejvýš ${MAX_WORDS} slov — ${pocet(filled.length - MAX_WORDS, SLOVA)} odeber.`)
  }

  const cols = parseWhole(draft.cols)
  const rows = parseWhole(draft.rows)
  if (draft.kind === 'wordsearch') {
    if (cols === null || cols < MIN_GRID_SIZE || cols > MAX_GRID_SIZE) {
      missing.push(`Sloupce: zadej číslo od ${MIN_GRID_SIZE} do ${MAX_GRID_SIZE}.`)
    }
    if (rows === null || rows < MIN_GRID_SIZE || rows > MAX_GRID_SIZE) {
      missing.push(`Řádky: zadej číslo od ${MIN_GRID_SIZE} do ${MAX_GRID_SIZE}.`)
    }
  } else {
    const phrase = draft.phrase.trim()
    if (phrase.length < 2) missing.push('Napiš tajenou větu, která se má z políček složit.')
    if (phrase.length > MAX_PHRASE_LENGTH) {
      missing.push(`Tajená věta může mít nejvýš ${MAX_PHRASE_LENGTH} znaků — zkrať ji.`)
    }
  }
  if (draft.instructions.length > MAX_INSTRUCTIONS_LENGTH) {
    missing.push(`Pokyn pro žáky může mít nejvýš ${MAX_INSTRUCTIONS_LENGTH} znaků — zkrať ho.`)
  }

  const title = draft.title.trim()
  if (title.length > MAX_TITLE_LENGTH) missing.push(`Název může mít nejvýš ${MAX_TITLE_LENGTH} znaků — zkrať ho.`)

  const previewable = missing.length === 0 || (broken > 0 && missing.length === 1 && usable.length >= MIN_WORDS)
  const parsed = previewable
    ? puzzleContentSchema.safeParse({
        kind: draft.kind,
        title: title || 'Bez názvu',
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
    // Pojistka: sem by se nemělo dojít, meze výš kopírují schéma.
    missing.push('Hlavolam se nedá složit. Zkontroluj slova a nastavení mřížky.')
  }
  const preview = parsed?.success ? parsed.data : null

  if (!title) missing.push('Doplň název hlavolamu — podle něj ho najdeš v knihovně.')
  const content = preview && missing.length === 0 ? { ...preview, title } : null
  return { preview, content, rowProblems, missing }
}

/** Číslo z odpovědi — přímo, nebo v objektu `counts`; server je zatím posílat nemusí. */
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

/** Hledání bez ohledu na velikost písmen a diakritiku. */
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
  /** Co tlačítko říká, dokud akce běží. */
  busyLabel: string
  destructive?: boolean
  run: () => Promise<void> | void
}

/**
 * Dílna na hlavolamy: vybrat téma, nechat vytáhnout slova, upravit seznam,
 * zvolit velikost mřížky nebo tajenou větu, vidět náhled a vytisknout.
 *
 * Náhled vychází z téhož výpočtu jako papír (`buildPuzzle` v core), takže se
 * obrazovka s tiskem nemůže rozejít.
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
  const muzeMenit = useMuzeMenit()
  const [start] = useState(emptyDraft)
  const [draft, setDraft] = useState<Draft>(start)
  /** Otisk naposledy uloženého (nebo otevřeného) stavu. */
  const [baseline, setBaseline] = useState(() => draftKey(start))
  const [wordCount, setWordCount] = useState(String(DEFAULT_WORD_COUNT))
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [printing, setPrinting] = useState<'plain' | 'key' | null>(null)
  const [opening, setOpening] = useState<string | null>(null)
  const [solved, setSolved] = useState(false)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  /** Písemky pro zařazení hlavolamu; načtou se, až o ně učitelka stojí. */
  const [pisemky, setPisemky] = useState<TestOption[] | 'loading' | null>(null)
  const [pisemkyHledat, setPisemkyHledat] = useState('')
  const [zarazuji, setZarazuji] = useState<string | null>(null)
  /**
   * Právě uložené a právě smazané hlavolamy si drží prohlížeč: `router.refresh()`
   * dorazí se zpožděním a učitelka musí hned vidět, že se uložení povedlo.
   * Jakmile obnovený seznam ze serveru dorazí, obě soupisky se v něm jen
   * překryjí — proto se skládá při vykreslení, ne v efektu.
   */
  const [ulozene, setUlozene] = useState<PuzzleListItem[]>([])
  const [smazane, setSmazane] = useState<string[]>([])
  const list = useMemo(() => {
    const byId = new Map<string, PuzzleListItem>()
    for (const item of [...ulozene, ...puzzles]) if (!byId.has(item.id)) byId.set(item.id, item)
    return [...byId.values()].filter((item) => !smazane.includes(item.id))
  }, [puzzles, ulozene, smazane])

  const check = useMemo(() => checkDraft(draft), [draft])
  const { content, preview, rowProblems, missing } = check
  const built = useMemo(() => (preview ? buildPuzzle(preview) : null), [preview])
  const problems = built ? puzzleProblems(built) : []
  const dirty = draftKey(draft) !== baseline

  /** Proč zatím nejde tisknout ani zařazovat; `null` = jde to. */
  const blockedReason = !content
    ? 'Tisknout a zařadit do písemky půjde, až bude hlavolam hotový (viz výše, co chybí).'
    : problems.length > 0
      ? 'Tisknout a zařadit do písemky půjde, až opravíš potíže vypsané výš — jinak by žák hledal, co na papíře není.'
      : null

  // Neuložené změny se při zavření záložky neztratí bez varování.
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

  /** Nahradí rozpracovaný hlavolam jiným a vezme ho jako uložený stav. */
  function resetTo(next: Draft): void {
    setDraft(next)
    setBaseline(draftKey(next))
  }

  /** Zeptá se, jestli zahodit neuložené změny; bez změn rovnou pokračuje. */
  function unlessDirty(action: string, run: () => Promise<void> | void): void {
    if (!dirty) {
      void run()
      return
    }
    setConfirmation({
      title: 'Zahodit neuložené změny?',
      description: `Rozpracovaný hlavolam má změny, které nejsou uložené. ${action} je zahodí.`,
      confirmLabel: 'Zahodit změny',
      busyLabel: 'Chvilku…',
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
  /** Kolik slov se ještě vejde — hlavolam má nejvýš 40. */
  const roomLeft = MAX_WORDS - filledCount
  const maxRequest = Math.max(MIN_WORDS, Math.min(MAX_WORDS, roomLeft))

  /** Slova od modelu. Mřížku skládá kód, model dodává jen slovní zásobu. */
  async function fetchWords(): Promise<void> {
    if (!draft.topicId) {
      toast.error('Vyber nejdřív téma, ze kterého se mají slova vzít.')
      return
    }
    if (roomLeft < MIN_WORDS) {
      toast.error(`Seznam je plný — hlavolam může mít nejvýš ${MAX_WORDS} slov.`)
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
            // Tajenka potřebuje slova s písmeny své věty, osmisměrka slova,
            // která se vejdou do mřížky — obojí server hlídá podle těchto polí.
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
        'Slova se nepodařilo vytáhnout.',
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
        ? `Nehodilo se: ${rejected.map((item) => `${item.word} (${item.reason})`).join(', ')}.`
        : dropped > 0
          ? `${pocet(dropped, SLOVA)} se do hlavolamu nehodilo a vynechalo se.`
          : ''
      if (entries.length === 0) {
        toast.warning('Model nedodal žádné nové slovo.', {
          description: `Zkus to znovu, vyber jiné téma, nebo slova napiš ručně. ${rejectedNote}`.trim(),
        })
      } else if (entries.length < requested / 2) {
        toast.warning(`Přibylo jen ${pocet(entries.length, SLOVA)} z ${requested} požadovaných.`, {
          description:
            `Materiály tématu jich víc asi nenabízejí. Zkus to znovu, nebo zbytek doplň ručně. ${rejectedNote}`.trim(),
        })
      } else if (typeof data.warning === 'string' && data.warning) {
        // Server ví víc než počty — třeba že tajence pořád chybí písmena.
        toast.warning(`Přibylo ${pocet(entries.length, SLOVA)}.`, {
          description: `${data.warning} ${rejectedNote}`.trim(),
        })
      } else {
        toast.success(`Přibylo ${pocet(entries.length, SLOVA)}.`, { description: rejectedNote || undefined })
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Slova se nepodařilo vytáhnout.'))
    } finally {
      setFetching(false)
    }
  }

  /**
   * Uloží hlavolam a vrátí jeho id. Rozbitý hlavolam (slovo se nevešlo…)
   * se uložit smí jako rozpracovaný, jen se to řekne nahlas.
   */
  async function save(options: { quiet?: boolean } = {}): Promise<string | null> {
    if (!content) {
      toast.error(missing[0] ?? 'Hlavolam ještě není hotový.')
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
        'Hlavolam se nepodařilo uložit.',
      )
      if (!data.puzzle) throw new Error(`Hlavolam se nepodařilo uložit. ${SERVER_TROUBLE}`)

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
      setUlozene((current) => [row, ...current.filter((item) => item.id !== row.id)])
      router.refresh()
      if (problems.length > 0) {
        toast.warning('Hlavolam je uložený, ale zatím se nedá vytisknout ani zařadit do písemky.', {
          description: problems[0]?.message,
        })
      } else if (!options.quiet) {
        toast.success(`Hlavolam „${saved.title}" je uložený.`)
      }
      return saved.id
    } catch (error) {
      toast.error(errorMessage(error, 'Hlavolam se nepodařilo uložit.'))
      return null
    } finally {
      setSaving(false)
    }
  }

  /** Uložené id; neuložené změny se nejdřív uloží. */
  async function savedId(): Promise<string | null> {
    if (draft.id && !dirty) return draft.id
    return save({ quiet: true })
  }

  /** Tisk jde vždycky z uloženého hlavolamu, ať papír odpovídá knihovně. */
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
      if (wasDirty) toast.success('Změny jsou uložené, posílám hlavolam do tisku.')
      await printPdf(`/api/puzzles/${id}/pdf${withKey ? '?key=1' : ''}`)
    } catch (error) {
      toast.error(errorMessage(error, 'Hlavolam se nepodařilo vytisknout.'))
    } finally {
      setPrinting(null)
    }
  }

  /** Otevře výběr z vlastních písemek; ukládá se až po výběru. */
  async function chooseTest(): Promise<void> {
    if (blockedReason) {
      toast.error(blockedReason)
      return
    }
    setPisemkyHledat('')
    setPisemky('loading')
    try {
      const data = await requestJson<{ tests: TestOption[] }>('/api/tests', undefined, 'Seznam písemek se nepodařilo načíst.')
      // Zařadit jde jen do vlastní písemky; nasdílené od kolegyň se jen čtou.
      setPisemky((data.tests ?? []).filter((test) => test.mine === undefined || Boolean(test.mine)))
    } catch (error) {
      setPisemky(null)
      toast.error(errorMessage(error, 'Seznam písemek se nepodařilo načíst.'))
    }
  }

  /** Zařadí hlavolam na konec vybrané písemky; neuložené změny se uloží. */
  async function addToTest(testId: string): Promise<void> {
    setZarazuji(testId)
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
        'Hlavolam se nepodařilo do písemky zařadit.',
      )
      setPisemky(null)
      toast.success(`Hlavolam je na konci písemky „${data.testTitle ?? ''}".`)
    } catch (error) {
      toast.error(errorMessage(error, 'Hlavolam se nepodařilo do písemky zařadit.'))
    } finally {
      setZarazuji(null)
    }
  }

  async function openPuzzle(id: string): Promise<void> {
    setOpening(id)
    try {
      const { puzzle } = await requestJson<{
        puzzle: PuzzleContent & { id: string; topicId: string | null }
      }>(`/api/puzzles/${id}`, undefined, 'Hlavolam se nepodařilo načíst.')
      if (!puzzle) throw new Error(`Hlavolam se nepodařilo načíst. ${SERVER_TROUBLE}`)
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
      toast.error(errorMessage(error, 'Hlavolam se nepodařilo načíst.'))
    } finally {
      setOpening(null)
    }
  }

  async function removePuzzle(id: string, title: string): Promise<void> {
    try {
      await requestJson(`/api/puzzles/${id}`, { method: 'DELETE' }, 'Hlavolam se nepodařilo smazat.')
    } catch (error) {
      toast.error(errorMessage(error, 'Hlavolam se nepodařilo smazat.'))
      return
    }
    if (draft.id === id) resetTo(emptyDraft())
    setSmazane((current) => [...current, id])
    setUlozene((current) => current.filter((item) => item.id !== id))
    toast.success(`Hlavolam „${title}" je smazaný.`)
    router.refresh()
  }

  function askRemove(id: string, title: string): void {
    setConfirmation({
      title: `Smazat hlavolam „${title}"?`,
      description:
        'Hlavolam zmizí z knihovny a vrátit to nepůjde. Písemky, do kterých už je zařazený, si ho ponechají.',
      confirmLabel: 'Smazat hlavolam',
      busyLabel: 'Mažu…',
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

  const hledat = fold(pisemkyHledat.trim())
  const nalezenePisemky =
    Array.isArray(pisemky) && hledat ? pisemky.filter((test) => fold(test.title).includes(hledat)) : pisemky

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Hlavolamy</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-soft">
            Osmisměrka a tajenka z materiálů tématu. Slova dodá model, mřížku skládá aplikace —
            vytiskne se na papír vedle písemky, nebo se zařadí přímo do ní.
          </p>
          {muzeMenit ? null : (
            <p className="mt-1 max-w-3xl text-sm text-fg-muted" data-slot="puzzle-read-only">
              Máš přístup jen pro čtení: uložené hlavolamy si otevřeš a vytiskneš, ale měnit je ani
              zakládat nové nemůžeš. Když potřebuješ víc, požádej správce školy o roli Učitelka.
            </p>
          )}
        </div>
        {/* Seznam uložených je až pod dílnou; na telefonu by se k němu nikdo neprohrabal. */}
        <a href="#ulozene-hlavolamy" className="text-sm text-fg-soft underline-offset-2 hover:underline">
          {pocet(list.length, HLAVOLAMY)} v knihovně
        </a>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4" aria-busy={opening !== null || undefined}>
          {opening ? (
            <p className="text-sm text-fg-muted" role="status" data-slot="puzzle-opening">
              Otevírám hlavolam…
            </p>
          ) : null}
          {/* Náhled si hlavolamy čte a tiskne, ale nemění — pole jsou zamčená celá najednou. */}
          <fieldset disabled={!muzeMenit} className="contents">
          <Card className="space-y-4 p-4">
            <div className="flex flex-wrap gap-3">
              <div className="w-48">
                <Label htmlFor="puzzle-kind">Druh hlavolamu</Label>
                <Select value={draft.kind} onValueChange={(value) => update({ kind: value as PuzzleKind })}>
                  <SelectTrigger id="puzzle-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PUZZLE_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {PUZZLE_KIND_LABELS[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-56 flex-1">
                <Label htmlFor="puzzle-title">Název</Label>
                <Input
                  id="puzzle-title"
                  value={draft.title}
                  maxLength={MAX_TITLE_LENGTH}
                  placeholder="Části rostliny"
                  aria-describedby="puzzle-title-hint"
                  onChange={(event) => update({ title: event.target.value })}
                />
                <p id="puzzle-title-hint" className="mt-1 text-xs text-fg-muted">
                  Povinný — tiskne se nad hlavolamem a podle něj ho najdeš v knihovně.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="min-w-56 flex-1">
                <Label htmlFor="puzzle-topic">Téma</Label>
                <Select
                  value={draft.topicId ?? 'none'}
                  onValueChange={(value) => {
                    const topicId = value === 'none' ? null : value
                    update({ topicId })
                    if (topicId && draft.entries.length === 0) {
                      // Naposledy vytažená slova k tématu; když se nenačtou, nic se neděje.
                      void fetch(`/api/puzzles/words?topicId=${encodeURIComponent(topicId)}&kind=${draft.kind}`)
                        .then((response) => (response.ok ? response.json() : { entries: [] }))
                        .then((data: { entries?: ApiEntry[] }) => {
                          const loaded = data.entries
                          if (!loaded?.length) return
                          // Odpověď chodí se zpožděním: mezitím mohla učitelka vybrat
                          // jiné téma nebo začít psát slova — ta se nepřepisují.
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
                    <SelectValue placeholder="Bez tématu" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Bez tématu</SelectItem>
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
                    <Label htmlFor="puzzle-word-count">Kolik slov</Label>
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
                      {roomLeft < MIN_WORDS ? 'Seznam je plný' : `${MIN_WORDS} až ${maxRequest}`}
                    </p>
                  </div>
                  <div className="flex items-start pt-5">
                    <BusyButton
                      variant="outline"
                      busy={fetching}
                      busyLabel="Hledám slova…"
                      disabled={roomLeft < MIN_WORDS}
                      onClick={() => void fetchWords()}
                    >
                      <Sparkles className="size-4" />
                      Vytáhnout slova z materiálů
                    </BusyButton>
                  </div>
                </>
              ) : (
                <p className="max-w-sm self-end text-sm text-fg-muted">
                  Vytahování slov z materiálů není v této škole zapnuté. Slova napiš ručně; zapnout ho
                  může správce aplikace.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="puzzle-instructions">Pokyn pro žáky</Label>
              <Textarea
                id="puzzle-instructions"
                value={draft.instructions}
                rows={2}
                maxLength={MAX_INSTRUCTIONS_LENGTH}
                placeholder="Prázdné = použije se běžné zadání podle druhu hlavolamu."
                onChange={(event) => update({ instructions: event.target.value })}
              />
            </div>

            {draft.kind === 'wordsearch' ? (
              <div className="flex flex-wrap items-start gap-3">
                {(['cols', 'rows'] as const).map((field) => (
                  <div key={field} className="w-24">
                    <Label htmlFor={`puzzle-${field}`}>{field === 'cols' ? 'Sloupce' : 'Řádky'}</Label>
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
                  {MIN_GRID_SIZE} až {MAX_GRID_SIZE}
                </p>
                <div className="pt-5">
                  <Button variant="outline" onClick={() => update({ seed: newSeed() })}>
                    Zamíchat znovu
                  </Button>
                </div>
                <label className="flex items-center gap-2 pt-7 text-sm">
                  <Checkbox
                    checked={draft.showClues}
                    onCheckedChange={(checked) => update({ showClues: checked === true })}
                  />
                  Vypsat i nápovědy
                </label>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1">
                  <Label htmlFor="puzzle-phrase">Tajená věta</Label>
                  <Input
                    id="puzzle-phrase"
                    value={draft.phrase}
                    maxLength={MAX_PHRASE_LENGTH}
                    placeholder="rostliny dýchají"
                    onChange={(event) => update({ phrase: event.target.value })}
                  />
                </div>
                <Button variant="outline" onClick={() => update({ seed: newSeed() })}>
                  Zamíchat znovu
                </Button>
              </div>
            )}
          </Card>
          </fieldset>

          <Card className="p-4">
            <fieldset disabled={!muzeMenit} className="contents">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium text-fg">Slova ({pocet(draft.entries.length, SLOVA)})</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => update({ entries: [...draft.entries, { word: '', clue: '' }] })}
              >
                <Plus className="size-4" />
                Přidat slovo
              </Button>
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              {draft.kind === 'wordsearch'
                ? `Slovo 2 až ${MAX_WORD_LENGTH} znaků. Nápověda se tiskne jen na přání${WORDSEARCH_BLANK_CLUE ? ' a smí zůstat prázdná' : ''}.`
                : `Slovo 2 až ${MAX_WORD_LENGTH} znaků, nápověda je povinná.`}{' '}
              Nejvýš {MAX_WORDS} slov.
            </p>

            {draft.entries.length === 0 ? (
              <p className="mt-3 text-sm text-fg-muted">
                Zatím tu nic není. Přidej slova ručně, nebo je nech vytáhnout z materiálů tématu.
              </p>
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
                          aria-label={`Slovo ${index + 1}`}
                          aria-invalid={problem?.level === 'danger' || undefined}
                          aria-describedby={problem ? problemId : undefined}
                          onChange={(event) => updateEntry(index, { word: event.target.value })}
                        />
                        <Input
                          className="min-w-48 flex-1"
                          value={entry.clue}
                          aria-label={`Nápověda ${index + 1}`}
                          aria-invalid={problem?.level === 'danger' || undefined}
                          aria-describedby={problem ? problemId : undefined}
                          onChange={(event) => updateEntry(index, { clue: event.target.value })}
                        />
                        <RowActions label={`Akce pro slovo ${entry.word || index + 1}`}>
                          <DropdownMenuItem variant="destructive" onSelect={() => removeEntry(index)}>
                            Odebrat slovo
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
                <p className="font-medium">Než půjde hlavolam uložit:</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {missing.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {muzeMenit ? (
                // Zablokované, i když ukládá tisk nebo zařazení — druhé kliknutí by poslalo druhý POST.
                <BusyButton busy={saving} busyLabel="Ukládám…" onClick={() => void save()}>
                  {draft.id ? 'Uložit změny' : 'Uložit hlavolam'}
                </BusyButton>
              ) : null}
              <BusyButton
                variant="outline"
                busy={printing === 'plain'}
                busyLabel="Připravuji tisk…"
                disabled={blockedReason !== null || printing !== null || saving || (!muzeMenit && (!draft.id || dirty))}
                aria-describedby={blockedReason ? 'puzzle-blocked' : undefined}
                onClick={() => void print(false)}
              >
                Vytisknout
              </BusyButton>
              <BusyButton
                variant="outline"
                busy={printing === 'key'}
                busyLabel="Připravuji tisk…"
                disabled={blockedReason !== null || printing !== null || saving || (!muzeMenit && (!draft.id || dirty))}
                aria-describedby={blockedReason ? 'puzzle-blocked' : undefined}
                onClick={() => void print(true)}
              >
                Vytisknout s řešením
              </BusyButton>
              {muzeMenit ? (
                <Button
                  variant="outline"
                  disabled={blockedReason !== null || saving}
                  aria-describedby={blockedReason ? 'puzzle-blocked' : undefined}
                  onClick={() => void chooseTest()}
                >
                  Zařadit do písemky
                </Button>
              ) : null}
              {draft.id || dirty ? (
                <Button
                  variant="ghost"
                  onClick={() => unlessDirty('Nový hlavolam', () => resetTo(emptyDraft()))}
                >
                  Nový hlavolam
                </Button>
              ) : null}
            </div>
            {blockedReason ? (
              <p id="puzzle-blocked" className="mt-2 text-sm text-fg-muted" data-slot="puzzle-blocked">
                {blockedReason}
              </p>
            ) : dirty && draft.id ? (
              <p className="mt-2 text-sm text-fg-muted">Máš neuložené změny.</p>
            ) : null}
          </Card>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium text-fg">Náhled</h2>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={solved} onCheckedChange={(checked) => setSolved(checked === true)} />
              Ukázat řešení
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
              title="Zatím není co ukázat"
              hint={
                !templateConfig
                  ? 'Náhled potřebuje šablonu písemky. Škola zatím žádnou nemá — požádej správce, ať ji přidá.'
                  : (missing.find((message) => !message.startsWith('Doplň název')) ??
                    'Náhled se objeví, jakmile budou v seznamu aspoň dvě slova.')
              }
            />
          )}
        </div>
      </div>

      <Dialog open={pisemky !== null} onOpenChange={(open) => (open ? null : setPisemky(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Do které písemky?</DialogTitle>
            <DialogDescription>
              Hlavolam přibude na konec vybrané písemky.
              {dirty || !draft.id ? ' Neuložené změny se před zařazením uloží.' : ''}
            </DialogDescription>
          </DialogHeader>
          {pisemky === 'loading' ? (
            <LoadingLines lines={4} />
          ) : pisemky && pisemky.length > 0 ? (
            <>
              <Input
                type="search"
                value={pisemkyHledat}
                placeholder="Hledat písemku podle názvu"
                aria-label="Hledat písemku"
                onChange={(event) => setPisemkyHledat(event.target.value)}
              />
              {nalezenePisemky && Array.isArray(nalezenePisemky) && nalezenePisemky.length > 0 ? (
                <ul className="max-h-80 divide-y divide-line overflow-y-auto" data-slot="puzzle-test-list">
                  {nalezenePisemky.map((pisemka) => (
                    <li key={pisemka.id}>
                      <button
                        type="button"
                        disabled={zarazuji !== null || saving}
                        className="flex w-full items-baseline justify-between gap-3 py-2 text-left text-sm text-fg hover:underline disabled:opacity-60"
                        onClick={() => void addToTest(pisemka.id)}
                      >
                        <span className="min-w-0 flex-1">
                          {zarazuji === pisemka.id ? 'Zařazuji…' : pisemka.title}
                        </span>
                        {pisemka.updatedAt ? (
                          <span className="shrink-0 text-xs text-fg-muted">
                            {new Date(pisemka.updatedAt).toLocaleDateString('cs-CZ')}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-muted">Žádná z tvých písemek se tak nejmenuje.</p>
              )}
            </>
          ) : (
            <p className="text-sm text-fg-muted">
              Zatím nemáš žádnou vlastní písemku — nejdřív si ji v Testech založ. Do písemek od
              kolegyň se zařazovat nedá; udělej si z nich kopii.
            </p>
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
            <AlertDialogCancel disabled={confirmBusy}>Nechat být</AlertDialogCancel>
            <AlertDialogAction
              variant={confirmation?.destructive ? 'destructive' : 'default'}
              disabled={confirmBusy}
              onClick={(event) => {
                // Dialog se zavře až po doběhnutí akce, ať je vidět, že běží.
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
        <h2 className="font-medium text-fg">Uložené hlavolamy</h2>
        {list.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">Ještě žádný hlavolam neexistuje.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line" data-slot="puzzle-list">
            {list.map((puzzle) => (
              <li key={puzzle.id} className="flex flex-wrap items-center gap-2 py-2">
                <button
                  type="button"
                  disabled={opening !== null}
                  className="min-w-0 flex-1 text-left text-sm text-fg hover:underline disabled:opacity-60"
                  onClick={() => unlessDirty('Otevření jiného hlavolamu', () => openPuzzle(puzzle.id))}
                >
                  {opening === puzzle.id ? 'Otevírám…' : puzzle.title}
                </button>
                <Badge variant="secondary">{PUZZLE_KIND_LABELS[puzzle.kind]}</Badge>
                <span className="text-sm text-fg-muted">
                  {puzzle.topicName ?? 'bez tématu'} · {pocet(puzzle.entryCount, SLOVA)}
                </span>
                <RowActions label={`Akce pro hlavolam ${puzzle.title}`}>
                  <DropdownMenuItem
                    onSelect={() => unlessDirty('Otevření jiného hlavolamu', () => openPuzzle(puzzle.id))}
                  >
                    Otevřít
                  </DropdownMenuItem>
                  {muzeMenit ? (
                    <DropdownMenuItem variant="destructive" onSelect={() => askRemove(puzzle.id, puzzle.title)}>
                      Smazat
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
