'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Question, QuestionStatus, QuestionType } from '@testmaker/core/schema'
import { QUESTION_TYPE_LABELS } from '@testmaker/core/schema'
import {
  Badge,
  BusyButton,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DeleteButton,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  OTAZKY,
  QuestionPreview,
  ReviewQueue,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  planUndo,
  pocet,
  toast,
} from '@testmaker/ui'
import { QuestionEditor } from '@/components/QuestionEditor'
import { RegenerateButton } from '@/components/RegenerateButton'

/** Seznam otázek k tématu s filtry, hromadnými akcemi a soustředěnou frontou ke schválení. */
export function ReviewPanel({ topicId, questions }: { topicId: string; questions: Question[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Hromadná akce má dvě části, které trvají: zápis na server a obnovení
  // stránky. `useTransition` pokrývá i tu druhou — bez něj tlačítko po zápisu
  // zase ožilo, ale seznam se ještě chvíli nehýbal a vypadalo to, že se nic
  // nestalo. `pending` říká, co se právě děje, aby to šlo napsat na tlačítko.
  const [pending, setPending] = useState<'approved' | 'rejected' | null>(null)
  const [refreshing, startRefresh] = useTransition()
  const [editing, setEditing] = useState<Question | 'new' | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [filters, setFilters] = useState<{
    type: QuestionType | ''
    status: QuestionStatus | ''
    difficulty: 1 | 2 | 3 | ''
    search: string
  }>({
    type: '',
    status: '',
    difficulty: '',
    search: '',
  })

  const visible = useMemo(() => {
    const needle = filters.search.trim().toLocaleLowerCase('cs')
    return questions.filter((question) => {
      if (filters.type && question.type !== filters.type) return false
      if (filters.status && question.status !== filters.status) return false
      if (filters.difficulty && question.difficulty !== filters.difficulty) return false
      if (needle && !JSON.stringify(question.payload).toLocaleLowerCase('cs').includes(needle)) return false
      return true
    })
  }, [questions, filters])

  /**
   * Fronta patří ke konceptům — dialog se jmenuje „Kontrola konceptů“ a
   * učitelka v ní nechce znovu potkávat, co už jednou schválila. Filtry se
   * přitom pořád uplatní, takže jde projít třeba jen lehké koncepty.
   */
  const drafts = useMemo(() => visible.filter((question) => question.status === 'draft'), [visible])

  /** Zápis stavu bez obnovení seznamu — hodí se, když se zapisuje víc dávek za sebou. */
  async function writeStatus(ids: string[], status: QuestionStatus) {
    if (ids.length === 0) return
    await fetch('/api/questions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids, status }),
    })
  }

  async function setStatus(ids: string[], status: QuestionStatus) {
    if (ids.length === 0) return
    await writeStatus(ids, status)
    startRefresh(() => router.refresh())
  }

  /**
   * Vrácení hromadné akce. Otázky mohly mít před ní různé stavy (něco byl
   * koncept, něco už bylo schválené), proto se vracejí po dávkách — plán
   * sestaví `planUndo`.
   */
  async function undoBulk(previous: [string, QuestionStatus][]) {
    for (const step of planUndo(previous)) {
      await writeStatus(step.ids, step.status)
    }
    startRefresh(() => router.refresh())
    toast.success(`Vráceno zpět: ${pocet(previous.length, OTAZKY)}`)
  }

  async function bulkStatus(next: 'approved' | 'rejected') {
    const ids = [...selected]
    if (ids.length === 0) return

    // Stavy před akcí se poznamenají dřív, než se seznam obnoví — jinak by
    // se „Vzít zpět“ nemělo k čemu vrátit.
    const previous = ids.flatMap((id): [string, QuestionStatus][] => {
      const question = questions.find((item) => item.id === id)
      return question ? [[id, question.status]] : []
    })

    setPending(next)
    try {
      await setStatus(ids, next)
      setSelected(new Set())
      toast.success(
        `${next === 'approved' ? 'Schváleno' : 'Zamítnuto'}: ${pocet(ids.length, OTAZKY)}`,
        {
          duration: 10_000,
          action: { label: 'Vzít zpět', onClick: () => void undoBulk(previous) },
        },
      )
    } finally {
      setPending(null)
    }
  }

  async function removeSelected() {
    if (selected.size === 0) return
    const query = [...selected].map((id) => `id=${encodeURIComponent(id)}`).join('&')
    await fetch(`/api/questions?${query}`, { method: 'DELETE' })
    setSelected(new Set())
    startRefresh(() => router.refresh())
  }

  /** Cokoli právě běží — zápis stavu i obnovení seznamu po něm. */
  const busy = pending !== null || refreshing

  /**
   * Hromadný výběr se vztahuje na to, co je právě vidět. Filtr („koncepty
   * střední obtížnosti") tak slouží zároveň jako výběr — učitelka si nastaví,
   * co chce schválit, a zaškrtne to jedním kliknutím.
   */
  const allVisibleSelected = visible.length > 0 && visible.every((question) => selected.has(question.id))
  const someVisibleSelected = visible.some((question) => selected.has(question.id))

  function toggleAllVisible() {
    setSelected((current) => {
      const next = new Set(current)
      for (const question of visible) {
        if (allVisibleSelected) next.delete(question.id)
        else next.add(question.id)
      }
      return next
    })
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">Otázky ({questions.length})</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <Label htmlFor="question-type-filter">Typ</Label>
            <Select
              value={filters.type || 'vse'}
              onValueChange={(value) =>
                setFilters({ ...filters, type: value === 'vse' ? '' : (value as QuestionType) })
              }
            >
              <SelectTrigger id="question-type-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vse">Všechny</SelectItem>
                {Object.entries(QUESTION_TYPE_LABELS).map(([type, label]) => (
                  <SelectItem key={type} value={type}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <Label htmlFor="question-status-filter">Stav</Label>
            <Select
              value={filters.status || 'vse'}
              onValueChange={(value) =>
                setFilters({ ...filters, status: value === 'vse' ? '' : (value as QuestionStatus) })
              }
            >
              <SelectTrigger id="question-status-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vse">Všechny</SelectItem>
                <SelectItem value="draft">Koncept</SelectItem>
                <SelectItem value="approved">Schválené</SelectItem>
                <SelectItem value="rejected">Zamítnuté</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <Label htmlFor="question-difficulty-filter">Obtížnost</Label>
            <Select
              value={filters.difficulty ? String(filters.difficulty) : 'vse'}
              onValueChange={(value) =>
                setFilters({ ...filters, difficulty: value === 'vse' ? '' : (Number(value) as 1 | 2 | 3) })
              }
            >
              <SelectTrigger id="question-difficulty-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vse">Všechny</SelectItem>
                <SelectItem value="1">Lehká</SelectItem>
                <SelectItem value="2">Střední</SelectItem>
                <SelectItem value="3">Těžká</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Label htmlFor="question-search-filter">Hledat</Label>
            <Input
              id="question-search-filter"
              value={filters.search}
              placeholder="text otázky"
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
          </div>
          <Button size="sm" variant="outline" onClick={() => setReviewing(true)} disabled={drafts.length === 0}>
            Projít po jedné ({drafts.length})
          </Button>
          {/* Fronta přes celou knihovnu — po hromadném generování je konceptů
              víc, než se dá odbavit po tématech. */}
          <Link href={`/review?topicId=${encodeURIComponent(topicId)}`}>
            <Button size="sm" variant="ghost">
              Kontrola v celé knihovně
            </Button>
          </Link>
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            Vlastní otázka
          </Button>
        </div>
      </div>

      {selected.size > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded bg-surface-muted px-3 py-2">
          <span className="text-sm text-fg-soft">Vybráno {selected.size}</span>
          <BusyButton
            size="sm"
            busy={pending === 'approved'}
            busyLabel="Schvaluji…"
            disabled={busy}
            onClick={() => void bulkStatus('approved')}
          >
            Schválit
          </BusyButton>
          <BusyButton
            size="sm"
            variant="outline"
            busy={pending === 'rejected'}
            busyLabel="Zamítám…"
            disabled={busy}
            onClick={() => void bulkStatus('rejected')}
          >
            Zamítnout
          </BusyButton>
          <DeleteButton
            label={`Smazat (${selected.size})`}
            variant="destructive"
            title="Smazat vybrané otázky?"
            description={`Smaže se ${pocet(selected.size, OTAZKY)}. Pokud jsou použité v uloženém testu, zmizí i odtamtud.`}
            onConfirm={removeSelected}
          />
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>
            Zrušit výběr
          </Button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={questions.length === 0 ? 'K tématu zatím nejsou otázky' : 'Filtru nic neodpovídá'}
            hint={questions.length === 0 ? 'Vygeneruj je z materiálů tématu, nebo přidej vlastní.' : undefined}
          />
        </div>
      ) : (
        <>
        <label className="mt-3 flex w-fit items-center gap-2 text-sm text-fg-soft">
          <Checkbox
            checked={allVisibleSelected ? true : someVisibleSelected ? 'indeterminate' : false}
            onCheckedChange={toggleAllVisible}
            aria-label="Vybrat vše"
          />
          Vybrat vše ({visible.length})
        </label>
        <ul className="mt-2 divide-y divide-line-soft">
          {visible.map((question) => (
            // Id otázky je v atributu, aby se dal v testech spárovat řádek se
            // záznamem v databázi; v rozhraní samotném nic neznamená.
            <li key={question.id} data-question-id={question.id} className="flex gap-3 py-3">
              <Checkbox
                className="mt-1"
                checked={selected.has(question.id)}
                onCheckedChange={() => toggle(question.id)}
              />
              <div className="min-w-0 flex-1">
                <QuestionPreview question={question} />
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                {question.status === 'draft' ? (
                  <Badge className="bg-draft-bg text-draft-fg">koncept</Badge>
                ) : null}
                {question.status === 'rejected' ? <Badge variant="destructive">zamítnuto</Badge> : null}
                <Button size="sm" variant="ghost" onClick={() => setEditing(question)}>
                  Upravit
                </Button>
                <RegenerateButton questionId={question.id} type={question.type} />
              </div>
            </li>
          ))}
        </ul>
        </>
      )}

      {editing ? (
        <QuestionEditor
          topicId={topicId}
          question={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            router.refresh()
          }}
        />
      ) : null}

      <Dialog open={reviewing} onOpenChange={setReviewing}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Kontrola konceptů</DialogTitle>
          </DialogHeader>
          {reviewing ? (
            <ReviewQueue
              questions={drafts}
              onApprove={(id) => void setStatus([id], 'approved')}
              onReject={(id) => void setStatus([id], 'rejected')}
              onEdit={(id) => {
                const question = questions.find((item) => item.id === id)
                if (question) setEditing(question)
                setReviewing(false)
              }}
              onClose={() => setReviewing(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
