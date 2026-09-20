'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Sparkles } from 'lucide-react'
import {
  buildPuzzle,
  puzzleContentSchema,
  puzzleProblems,
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  PUZZLE_KIND_LABELS,
  PUZZLE_KINDS,
  type PuzzleContent,
  type PuzzleEntry,
  type PuzzleKind,
  type TemplateConfig,
} from '@testmaker/core'
import {
  Badge,
  BusyButton,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenuItem,
  EmptyState,
  Input,
  Label,
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
import { RowActions } from '@/components/RowActions'
import type { PuzzleListItem, PuzzleTopic } from '@/lib/puzzles'

/** Hlavolam tak, jak ho vrací API po uložení. */
type PuzzleListRow = PuzzleContent & { id: string; topicId: string | null; updatedAt: string }

const SLOVA: PluralForms = ['slovo', 'slova', 'slov']
const HLAVOLAMY: PluralForms = ['hlavolam', 'hlavolamy', 'hlavolamů']

/** Kolik slov se od modelu žádá, když si učitelka nezvolí jinak. */
const DEFAULT_WORD_COUNT = 12

interface Draft {
  /** Id uloženého hlavolamu; `null` u rozpracovaného. */
  id: string | null
  kind: PuzzleKind
  title: string
  instructions: string
  topicId: string | null
  entries: PuzzleEntry[]
  cols: number
  rows: number
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
    cols: 12,
    rows: 12,
    phrase: '',
    seed: newSeed(),
    showClues: false,
  }
}

/** Nový los mřížky — krátký, aby se dal opsat i přečíst. */
function newSeed(): string {
  return Math.random().toString(36).slice(2, 8)
}

/** Rozpracovaný hlavolam na tvar podle schématu; `null` = ještě není co skládat. */
function toContent(draft: Draft): PuzzleContent | null {
  const parsed = puzzleContentSchema.safeParse({
    kind: draft.kind,
    title: draft.title.trim() || 'Hlavolam',
    instructions: draft.instructions,
    entries: draft.entries
      .map((entry) => ({ word: entry.word.trim(), clue: entry.clue.trim() }))
      .filter((entry) => entry.word.length >= 2 && entry.clue.length >= 2),
    payload:
      draft.kind === 'wordsearch'
        ? { cols: draft.cols, rows: draft.rows, seed: draft.seed, showClues: draft.showClues }
        : { phrase: draft.phrase, seed: draft.seed },
  })
  return parsed.success ? parsed.data : null
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
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [wordCount, setWordCount] = useState(DEFAULT_WORD_COUNT)
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [solved, setSolved] = useState(false)
  /** Písemky pro zařazení hlavolamu; načtou se, až o ně učitelka stojí. */
  const [pisemky, setPisemky] = useState<{ id: string; title: string }[] | null>(null)
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

  const content = useMemo(() => toContent(draft), [draft])
  const built = useMemo(() => (content ? buildPuzzle(content) : null), [content])
  const problems = built ? puzzleProblems(built) : []

  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }))

  function updateEntry(index: number, patch: Partial<PuzzleEntry>): void {
    setDraft((current) => ({
      ...current,
      entries: current.entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    }))
  }

  function removeEntry(index: number): void {
    setDraft((current) => ({ ...current, entries: current.entries.filter((_, i) => i !== index) }))
  }

  /** Slova od modelu. Mřížku skládá kód, model dodává jen slovní zásobu. */
  async function fetchWords(): Promise<void> {
    if (!draft.topicId) {
      toast.error('Vyber nejdřív téma, ze kterého se mají slova vzít.')
      return
    }
    setFetching(true)
    try {
      const response = await fetch('/api/puzzles/words', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topicId: draft.topicId,
          kind: draft.kind,
          count: wordCount,
          avoid: draft.entries.map((entry) => entry.word).filter(Boolean),
        }),
      })
      const data = (await response.json()) as {
        entries?: PuzzleEntry[]
        rejected?: { word: string; reason: string }[]
        error?: string
      }
      if (!response.ok) throw new Error(data.error ?? 'Slova se nepodařilo vytáhnout.')

      const entries = data.entries ?? []
      setDraft((current) => ({ ...current, entries: [...current.entries, ...entries] }))
      toast.success(`Přibylo ${pocet(entries.length, SLOVA)}.`, {
        description: data.rejected?.length
          ? `Model vrátil i ${pocet(data.rejected.length, SLOVA)}, která se do hlavolamu nehodí: ${data.rejected
              .map((item) => `${item.word} (${item.reason})`)
              .join(', ')}`
          : undefined,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Slova se nepodařilo vytáhnout.')
    } finally {
      setFetching(false)
    }
  }

  /** Uloží hlavolam a vrátí jeho id — tisk se bez uloženého neobejde. */
  async function save(): Promise<string | null> {
    if (!content) {
      toast.error('Hlavolam ještě není hotový: potřebuje název a aspoň dvě slova s nápovědou.')
      return null
    }
    setSaving(true)
    try {
      const response = draft.id
        ? await fetch(`/api/puzzles/${draft.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ puzzle: content, topicId: draft.topicId }),
          })
        : await fetch('/api/puzzles', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ puzzle: content, topicId: draft.topicId }),
          })
      const data = (await response.json()) as { puzzle?: PuzzleListRow; error?: string }
      if (!response.ok || !data.puzzle) throw new Error(data.error ?? 'Hlavolam se nepodařilo uložit.')

      const saved = data.puzzle
      update({ id: saved.id })
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
      return saved.id
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Hlavolam se nepodařilo uložit.')
      return null
    } finally {
      setSaving(false)
    }
  }

  /** Tisk jde vždycky z uloženého hlavolamu, ať papír odpovídá knihovně. */
  async function print(withKey: boolean): Promise<void> {
    const id = await save()
    if (!id) return
    await printPdf(`/api/puzzles/${id}/pdf${withKey ? '?key=1' : ''}`)
  }

  /** Otevře výběr písemek, do které se má hlavolam zařadit. */
  async function chooseTest(): Promise<void> {
    const id = await save()
    if (!id) return
    const response = await fetch('/api/tests')
    if (!response.ok) {
      toast.error('Seznam písemek se nepodařilo načíst.')
      return
    }
    const { tests } = (await response.json()) as { tests: { id: string; title: string }[] }
    setPisemky(tests)
  }

  /** Zařadí hlavolam na konec vybrané písemky. */
  async function addToTest(testId: string): Promise<void> {
    if (!draft.id) return
    const response = await fetch(`/api/puzzles/${draft.id}/to-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ testId }),
    })
    const data = (await response.json()) as { testTitle?: string; error?: string }
    if (!response.ok) {
      toast.error(data.error ?? 'Hlavolam se nepodařilo do písemky zařadit.')
      return
    }
    setPisemky(null)
    toast.success(`Hlavolam je na konci písemky „${data.testTitle ?? ''}".`)
  }

  async function openPuzzle(id: string): Promise<void> {
    const response = await fetch(`/api/puzzles/${id}`)
    if (!response.ok) {
      toast.error('Hlavolam se nepodařilo načíst.')
      return
    }
    const { puzzle } = (await response.json()) as { puzzle: PuzzleContent & { id: string; topicId: string | null } }
    setDraft({
      id: puzzle.id,
      kind: puzzle.kind,
      title: puzzle.title,
      instructions: puzzle.instructions,
      topicId: puzzle.topicId,
      entries: puzzle.entries,
      cols: puzzle.kind === 'wordsearch' ? puzzle.payload.cols : 12,
      rows: puzzle.kind === 'wordsearch' ? puzzle.payload.rows : 12,
      showClues: puzzle.kind === 'wordsearch' ? puzzle.payload.showClues : false,
      phrase: puzzle.kind === 'cryptogram' ? puzzle.payload.phrase : '',
      seed: puzzle.payload.seed,
    })
  }

  async function removePuzzle(id: string, title: string): Promise<void> {
    const response = await fetch(`/api/puzzles/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      toast.error('Hlavolam se nepodařilo smazat.')
      return
    }
    if (draft.id === id) setDraft(emptyDraft())
    setSmazane((current) => [...current, id])
    setUlozene((current) => current.filter((item) => item.id !== id))
    toast.success(`Hlavolam „${title}" je smazaný.`)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="ui-page-title">Hlavolamy</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-soft">
            Osmisměrka a tajenka z materiálů tématu. Slova dodá model, mřížku skládá aplikace —
            vytiskne se na papír vedle písemky, nebo se zařadí přímo do ní.
          </p>
        </div>
        <p className="text-sm text-fg-muted">{pocet(list.length, HLAVOLAMY)} v knihovně</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
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
                  placeholder="Části rostliny"
                  onChange={(event) => update({ title: event.target.value })}
                />
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
                      void fetch(`/api/puzzles/words?topicId=${encodeURIComponent(topicId)}&kind=${draft.kind}`)
                        .then((response) => (response.ok ? response.json() : { entries: [] }))
                        .then((data: { entries?: PuzzleEntry[] }) => {
                          if (data.entries?.length) update({ entries: data.entries })
                        })
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
                  <div className="w-28">
                    <Label htmlFor="puzzle-word-count">Kolik slov</Label>
                    <Input
                      id="puzzle-word-count"
                      type="number"
                      min={2}
                      max={40}
                      value={wordCount}
                      onChange={(event) => setWordCount(Number(event.target.value) || DEFAULT_WORD_COUNT)}
                    />
                  </div>
                  <div className="flex items-end">
                    <BusyButton
                      variant="outline"
                      busy={fetching}
                      busyLabel="Hledám slova…"
                      onClick={() => void fetchWords()}
                    >
                      <Sparkles className="size-4" />
                      Vytáhnout slova z materiálů
                    </BusyButton>
                  </div>
                </>
              ) : (
                <p className="max-w-sm self-end text-sm text-fg-muted">
                  Vytahování slov modelem není nastavené (chybí klíč v .env.local). Slova napiš ručně.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="puzzle-instructions">Pokyn pro žáky</Label>
              <Textarea
                id="puzzle-instructions"
                value={draft.instructions}
                rows={2}
                placeholder="Prázdné = použije se běžné zadání podle druhu hlavolamu."
                onChange={(event) => update({ instructions: event.target.value })}
              />
            </div>

            {draft.kind === 'wordsearch' ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-24">
                  <Label htmlFor="puzzle-cols">Sloupce</Label>
                  <Input
                    id="puzzle-cols"
                    type="number"
                    min={MIN_GRID_SIZE}
                    max={MAX_GRID_SIZE}
                    value={draft.cols}
                    onChange={(event) => update({ cols: Number(event.target.value) || MIN_GRID_SIZE })}
                  />
                </div>
                <div className="w-24">
                  <Label htmlFor="puzzle-rows">Řádky</Label>
                  <Input
                    id="puzzle-rows"
                    type="number"
                    min={MIN_GRID_SIZE}
                    max={MAX_GRID_SIZE}
                    value={draft.rows}
                    onChange={(event) => update({ rows: Number(event.target.value) || MIN_GRID_SIZE })}
                  />
                </div>
                <Button variant="outline" onClick={() => update({ seed: newSeed() })}>
                  Zamíchat znovu
                </Button>
                <label className="flex items-center gap-2 pb-2 text-sm">
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

          <Card className="p-4">
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

            {draft.entries.length === 0 ? (
              <p className="mt-3 text-sm text-fg-muted">
                Zatím tu nic není. Přidej slova ručně, nebo je nech vytáhnout z materiálů tématu.
              </p>
            ) : (
              <ul className="mt-3 space-y-2" data-slot="puzzle-entries">
                {draft.entries.map((entry, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2">
                    <Input
                      className="w-40"
                      value={entry.word}
                      aria-label={`Slovo ${index + 1}`}
                      onChange={(event) => updateEntry(index, { word: event.target.value })}
                    />
                    <Input
                      className="min-w-48 flex-1"
                      value={entry.clue}
                      aria-label={`Nápověda ${index + 1}`}
                      onChange={(event) => updateEntry(index, { clue: event.target.value })}
                    />
                    <RowActions label={`Akce pro slovo ${entry.word || index + 1}`}>
                      <DropdownMenuItem variant="destructive" onSelect={() => removeEntry(index)}>
                        Odebrat slovo
                      </DropdownMenuItem>
                    </RowActions>
                  </li>
                ))}
              </ul>
            )}

            {problems.length > 0 ? (
              <ul className="mt-3 space-y-1 text-sm text-danger" data-slot="puzzle-problems">
                {problems.map((problem, index) => (
                  <li key={index}>{problem.message}</li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <BusyButton busy={saving} busyLabel="Ukládám…" onClick={() => void save()}>
                {draft.id ? 'Uložit změny' : 'Uložit hlavolam'}
              </BusyButton>
              <Button variant="outline" onClick={() => void print(false)}>
                Vytisknout
              </Button>
              <Button variant="outline" onClick={() => void print(true)}>
                Vytisknout s řešením
              </Button>
              <Button variant="outline" onClick={() => void chooseTest()}>
                Zařadit do písemky
              </Button>
              {draft.id ? (
                <Button variant="ghost" onClick={() => setDraft(emptyDraft())}>
                  Nový hlavolam
                </Button>
              ) : null}
            </div>
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

          {content && templateConfig ? (
            <PaperSheet config={templateConfig}>
              <PaperPuzzle puzzle={content} built={built ?? undefined} solved={solved} />
            </PaperSheet>
          ) : (
            <EmptyState
              title="Zatím není co ukázat"
              hint="Náhled se objeví, jakmile bude mít hlavolam název a aspoň dvě slova s nápovědou."
            />
          )}
        </div>
      </div>

      <Dialog open={pisemky !== null} onOpenChange={(open) => (open ? null : setPisemky(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Do které písemky?</DialogTitle>
          </DialogHeader>
          {pisemky && pisemky.length > 0 ? (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto">
              {pisemky.map((pisemka) => (
                <li key={pisemka.id}>
                  <button
                    type="button"
                    className="w-full py-2 text-left text-sm text-fg hover:underline"
                    onClick={() => void addToTest(pisemka.id)}
                  >
                    {pisemka.title}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">
              Zatím není do čeho zařazovat — nejdřív si v Testech založ písemku.
            </p>
          )}
        </DialogContent>
      </Dialog>

      <Card className="p-4">
        <h2 className="font-medium text-fg">Uložené hlavolamy</h2>
        {list.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">Ještě žádný hlavolam neexistuje.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line" data-slot="puzzle-list">
            {list.map((puzzle) => (
              <li key={puzzle.id} className="flex flex-wrap items-center gap-2 py-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left text-sm text-fg hover:underline"
                  onClick={() => void openPuzzle(puzzle.id)}
                >
                  {puzzle.title}
                </button>
                <Badge variant="secondary">{PUZZLE_KIND_LABELS[puzzle.kind]}</Badge>
                <span className="text-sm text-fg-muted">
                  {puzzle.topicName ?? 'bez tématu'} · {pocet(puzzle.entryCount, SLOVA)}
                </span>
                <RowActions label={`Akce pro hlavolam ${puzzle.title}`}>
                  <DropdownMenuItem onSelect={() => void openPuzzle(puzzle.id)}>Otevřít</DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => void removePuzzle(puzzle.id, puzzle.title)}
                  >
                    Smazat
                  </DropdownMenuItem>
                </RowActions>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
