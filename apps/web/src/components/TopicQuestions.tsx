'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, QuestionType } from '@testmaker/core/schema'
import { QUESTION_TYPE_LABELS } from '@testmaker/core/schema'
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@testmaker/ui'
import { QuestionEditorForm } from '@/components/QuestionEditor'
import { QuestionCard } from '@/components/QuestionCard'
import { SelectionBar } from '@/components/SelectionBar'
import { useMuzeMenit } from '@/components/Prava'
import { rejectQuestions, restoreStatuses } from '@/lib/questionStatusClient'
import { emptyHeader } from '@/components/test-builder/defaults'
import { newId } from '@/lib/ids'

interface Filters {
  type: QuestionType | ''
  difficulty: 1 | 2 | 3 | ''
  /** „Jen nepoužité v testu" — schová otázky, které se aspoň v jednom viditelném testu už objevily. */
  onlyUnused: boolean
}

export interface TestUsage {
  testId: string
  title: string
}

export interface TopicQuestionsHandle {
  /**
   * Otevře formulář „Nová otázka" zvenčí — z prázdného stavu tématu
   * (`EmptyState` v `TopicWorkspace`), kde tahle karta zprvu není vidět.
   */
  openCreate: () => void
}

/**
 * Otázky tématu jako karty: úprava přímo na místě, přegenerování, smazání
 * s vrácením a přidání vlastní — bez fronty ke schválení, ta v tématu končí.
 *
 * Karta rozpracované úpravy se drží podle `id` otázky, ne podle pozice v poli
 * `questions` — to se mění s každým `router.refresh()` (dogenerování,
 * smazání jiné karty), ale rozepsaná úprava zůstává otevřená dál.
 */
export const TopicQuestions = forwardRef<
  TopicQuestionsHandle,
  {
    /** Metadata tématu potřebná k založení testu rovnou z výběru otázek. */
    topic: { id: string; name: string; subjectName: string; gradeId: string; gradeName: string }
    /** Výchozí šablona nové písemky (stejná volba jako u testu z prázdna). */
    defaultTemplateId: string
    questions: Question[]
    /** Testy, ve kterých otázka už je — jen ty viditelné volající. Chybějící klíč = nikde. */
    usage: Record<string, TestUsage[]>
    /**
     * Počet smazaných (zamítnutých) otázek tématu, načtený se stránkou.
     * Seznam smazaných karet se dotahuje zvlášť, až po zapnutí přepínače.
     */
    rejectedCount: number
  }
>(function TopicQuestions({ topic, defaultTemplateId, questions, usage, rejectedCount }, ref) {
  const router = useRouter()
  const muzeMenit = useMuzeMenit()
  const [creating, setCreating] = useState(false)
  useImperativeHandle(ref, () => ({
    openCreate: () => setCreating(true),
  }))
  const [editingId, setEditingId] = useState<string | null>(null)
  // Smazaná (i přegenerovaná) karta zmizí hned, bez čekání na obnovení seznamu
  // ze serveru — tahle množina je jediné místo, kde se to pozná.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  // Otázka, u které se právě maže — chrání proti dvojímu kliknutí, než dojde
  // odpověď ze serveru (smazání je optimistické, karta zmizí ještě dřív).
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState<Filters>({ type: '', difficulty: '', onlyUnused: false })
  // Zaškrtnuté otázky do nového testu. Smazaná (i přegenerovaná) karta z výběru
  // sama zmizí — výběr se počítá jen proti otázkám, které pořád existují
  // (`active`), takže o odebrání se tahle množina starat nemusí.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [creatingTest, setCreatingTest] = useState(false)
  // Smazané otázky se zvlášť: `null` znamená „ještě nenačteno" — teprve po
  // zapnutí přepínače se pro ně pošle dotaz, aby se nenačítaly zbytečně
  // pokaždé, když učitelka otevře téma.
  const [showDeleted, setShowDeleted] = useState(false)
  const [deletedQuestions, setDeletedQuestions] = useState<Question[] | null>(null)
  const [loadingDeleted, setLoadingDeleted] = useState(false)
  // Otázka, u které se právě obnovuje stav — chrání proti dvojímu kliknutí
  // na „Obnovit", stejně jako `busyIds` u mazání.
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set())
  // Kolik se toho od posledního obnovení stránky ze serveru smazalo (+) nebo
  // vrátilo (-), aniž by se to promítlo do `rejectedCount` — ten se totiž
  // nemění, dokud stránku neobnoví `router.refresh()`. Jakmile se to stane
  // a `rejectedCount` se posune, delta se zase vynuluje.
  const [deletedDelta, setDeletedDelta] = useState(0)
  const previousRejectedCount = useRef(rejectedCount)
  useEffect(() => {
    if (rejectedCount !== previousRejectedCount.current) {
      previousRejectedCount.current = rejectedCount
      setDeletedDelta(0)
    }
  }, [rejectedCount])

  // Dokud se seznam smazaných nenačetl, počet se počítá z hodnoty ze
  // serveru a lokální delty; jakmile se seznam jednou stáhne, počítá se
  // přímo z něj — ten se při obnovení karty zmenšuje sám.
  const deletedCount = deletedQuestions?.length ?? rejectedCount + deletedDelta

  const sorted = useMemo(
    () =>
      questions
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    [questions],
  )

  // Smazané (nebo přegenerované) karty se z tématu odečítají úplně — na
  // hlavičce i na nabídce typů v filtru; filtr sám počet dál nemění.
  const active = useMemo(() => sorted.filter((question) => !hiddenIds.has(question.id)), [sorted, hiddenIds])

  // Filtr typu nabízí jen typy, které v tématu opravdu jsou — jinak by
  // učitelka zvolila „Doplňovačka“ a dostala prázdno, i kdyby v tématu žádná
  // nebyla nikdy.
  const availableTypes = useMemo(() => {
    const present = new Set(active.map((question) => question.type))
    return (Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).filter((type) => present.has(type))
  }, [active])

  const visible = active.filter((question) => {
    if (filters.type && question.type !== filters.type) return false
    if (filters.difficulty && question.difficulty !== filters.difficulty) return false
    if (filters.onlyUnused && (usage[question.id]?.length ?? 0) > 0) return false
    return true
  })

  function resetFilters() {
    setFilters({ type: '', difficulty: '', onlyUnused: false })
  }

  /**
   * Vybrané otázky, které pořád existují, v pořadí, v jakém stojí v seznamu
   * (`active`) — ne v pořadí zaškrtnutí. Smazaná nebo přegenerovaná karta tak
   * z výběru i ze součtu bodů zmizí sama, jen tím, že vypadne z `active`.
   */
  const selectedQuestions = useMemo(
    () => active.filter((question) => selectedIds.has(question.id)),
    [active, selectedIds],
  )
  const selectedPoints = selectedQuestions.reduce((sum, question) => sum + question.points, 0)
  // Kolik vybraných otázek aktuální filtr schovává — bez toho by po zapnutí
  // filtru vypadalo, že se výběr sám o sobě zmenšil, i když otázky zůstaly
  // vybrané, jen nejsou vidět.
  const hiddenSelectedCount = useMemo(() => {
    const visibleIds = new Set(visible.map((question) => question.id))
    return selectedQuestions.filter((question) => !visibleIds.has(question.id)).length
  }, [visible, selectedQuestions])

  function toggleSelection(questionId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(questionId)) next.delete(questionId)
      else next.add(questionId)
      return next
    })
  }

  /** Nový test rovnou z vybraných otázek tématu — název přebírá od tématu. */
  async function createTestFromSelection() {
    if (selectedQuestions.length === 0) return
    setCreatingTest(true)
    try {
      const response = await fetch('/api/tests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: topic.name,
          templateId: defaultTemplateId,
          header: { ...emptyHeader(), subject: topic.subjectName },
          gradeId: topic.gradeId,
          items: selectedQuestions.map((question) => ({
            id: newId(),
            kind: 'question',
            questionId: question.id,
            puzzleId: null,
            text: null,
            pointsOverride: null,
            linesOverride: null,
          })),
        }),
      })
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(detail.error ?? `Test se nepodařilo založit (${response.status})`)
      }
      const result = (await response.json()) as { id: string }
      // `refresh()` před `push()`: bez něj zůstane tahle stránka tématu
      // v historii se starým stavem (bez štítku „V testu“) a návrat tlačítkem
      // zpět ho ukáže neaktuální.
      router.refresh()
      router.push(`/tests/${result.id}?tema=${topic.id}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Test se nepodařilo založit')
      setCreatingTest(false)
    }
  }

  /** Smazání beze ptaní — jde hned vrátit zpět, proto tu není potvrzovací dialog. */
  async function remove(question: Question) {
    if (busyIds.has(question.id)) return
    setBusyIds((current) => new Set(current).add(question.id))
    // Optimisticky: karta zmizí hned, ať smazání nečeká na odpověď ze
    // serveru. Nepovede-li se, karta se vrátí a chyba se ohlásí hláškou.
    setHiddenIds((current) => new Set(current).add(question.id))
    try {
      const previous = await rejectQuestions([question])
      // Smazaná karta se počítá do „Smazané" hned, ne až po obnovení
      // stránky ze serveru — a přibude i do už načteného seznamu smazaných,
      // ať je vidět, i když se panel zrovna teď zapne.
      setDeletedDelta((current) => current + 1)
      setDeletedQuestions((current) =>
        current === null ? null : [{ ...question, status: 'rejected' }, ...current],
      )
      toast.success('Otázka smazána', {
        duration: 10_000,
        action: {
          label: 'Vrátit zpět',
          onClick: () =>
            void restoreStatuses(previous)
              .then(() => {
                setHiddenIds((current) => {
                  const next = new Set(current)
                  next.delete(question.id)
                  return next
                })
                setDeletedDelta((current) => Math.max(0, current - 1))
                setDeletedQuestions((current) =>
                  current === null ? null : current.filter((q) => q.id !== question.id),
                )
                toast.success('Vráceno zpět')
                router.refresh()
              })
              .catch((error) =>
                toast.error(error instanceof Error ? error.message : 'Vrácení se nepodařilo'),
              ),
        },
      })
    } catch (error) {
      // Smazání se nepovedlo — karta se vrátí zpátky do seznamu.
      setHiddenIds((current) => {
        const next = new Set(current)
        next.delete(question.id)
        return next
      })
      toast.error(error instanceof Error ? error.message : 'Otázku se nepodařilo smazat')
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(question.id)
        return next
      })
    }
  }

  /** Dotáhne smazané (zamítnuté) otázky tématu — jen jednou, při prvním zapnutí. */
  async function loadDeleted() {
    setLoadingDeleted(true)
    try {
      const response = await fetch(
        `/api/questions?topicId=${encodeURIComponent(topic.id)}&status=rejected`,
      )
      if (!response.ok) throw new Error('Smazané otázky se nepodařilo načíst.')
      const data = (await response.json()) as { items: Question[] }
      setDeletedQuestions(data.items)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Smazané otázky se nepodařilo načíst.')
      setShowDeleted(false)
    } finally {
      setLoadingDeleted(false)
    }
  }

  function toggleShowDeleted() {
    setShowDeleted((current) => {
      const next = !current
      if (next && deletedQuestions === null) void loadDeleted()
      return next
    })
  }

  /** Vrátí smazanou otázku zpátky mezi schválené. */
  async function restore(question: Question) {
    if (restoringIds.has(question.id)) return
    setRestoringIds((current) => new Set(current).add(question.id))
    try {
      await restoreStatuses([[question.id, 'approved']])
      setDeletedQuestions((current) => (current ?? []).filter((q) => q.id !== question.id))
      setDeletedDelta((current) => Math.max(0, current - 1))
      // Otázka se mohla schovat i tady (smazáním v tomhle náčtu stránky) —
      // bez odebrání z `hiddenIds` by po obnovení zůstala v běžném seznamu
      // dál skrytá, i když ji server už znovu posílá jako schválenou.
      setHiddenIds((current) => {
        const next = new Set(current)
        next.delete(question.id)
        return next
      })
      toast.success('Otázka obnovena')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Otázku se nepodařilo obnovit')
    } finally {
      setRestoringIds((current) => {
        const next = new Set(current)
        next.delete(question.id)
        return next
      })
    }
  }

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold text-fg">Otázky ({active.length})</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <Label htmlFor="topic-question-type-filter">Typ</Label>
            <Select
              value={filters.type || 'vse'}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  type: value === 'vse' ? '' : (value as QuestionType),
                }))
              }
            >
              <SelectTrigger id="topic-question-type-filter" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vse">Všechny typy</SelectItem>
                {availableTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {QUESTION_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-36">
            <Label htmlFor="topic-question-difficulty-filter">Obtížnost</Label>
            <Select
              value={filters.difficulty ? String(filters.difficulty) : 'vse'}
              onValueChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  difficulty: value === 'vse' ? '' : (Number(value) as 1 | 2 | 3),
                }))
              }
            >
              <SelectTrigger id="topic-question-difficulty-filter" className="w-full">
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
          <label className="flex items-center gap-2 pb-2 text-sm text-fg-soft">
            <Checkbox
              checked={filters.onlyUnused}
              onCheckedChange={(checked) =>
                setFilters((current) => ({ ...current, onlyUnused: checked === true }))
              }
            />
            Jen nepoužité v testu
          </label>
          {muzeMenit ? (
            <Button
              size="sm"
              variant={showDeleted ? 'secondary' : 'outline'}
              aria-pressed={showDeleted}
              onClick={toggleShowDeleted}
            >
              Smazané ({deletedCount})
            </Button>
          ) : null}
          {muzeMenit ? (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)} disabled={creating}>
              Nová otázka
            </Button>
          ) : null}
        </div>
      </div>

      {creating ? (
        <div
          data-testid="new-question-form"
          className="mt-3 rounded-[var(--radius-outer)] border border-line p-3"
        >
          <QuestionEditorForm
            topicId={topic.id}
            question={null}
            onCancel={() => setCreating(false)}
            onSaved={() => {
              setCreating(false)
              router.refresh()
            }}
          />
        </div>
      ) : null}

      {visible.length === 0 && !creating ? (
        <div className="mt-4">
          {active.length === 0 ? (
            <EmptyState
              title="V tématu zatím nejsou otázky."
              // Náhled (role `nahled`) si nepíše otázky sama — ten dodatek
              // by jí jen nabízel akci, kterou nemá.
              hint={muzeMenit ? 'Nech je vygenerovat, nebo napiš první sama.' : 'Nech je vygenerovat.'}
            />
          ) : (
            <EmptyState
              title="Filtru neodpovídá žádná otázka."
              action={
                <Button variant="outline" onClick={resetFilters}>
                  Zrušit filtr
                </Button>
              }
            />
          )}
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-line-soft">
          {visible.map((question) => (
            <li key={question.id} data-question-id={question.id} className="py-3">
              <QuestionCard
                topicId={topic.id}
                question={question}
                editing={editingId === question.id}
                muzeMenit={muzeMenit}
                selected={selectedIds.has(question.id)}
                busy={busyIds.has(question.id)}
                usage={usage[question.id]}
                onEditStart={() => setEditingId(question.id)}
                onEditCancel={() => setEditingId(null)}
                onEditSaved={() => {
                  setEditingId(null)
                  router.refresh()
                }}
                onToggleSelect={() => toggleSelection(question.id)}
                onRegenerateDone={() => setHiddenIds((current) => new Set(current).add(question.id))}
                onRemove={() => void remove(question)}
              />
            </li>
          ))}
        </ul>
      )}

      {selectedQuestions.length > 0 ? (
        <SelectionBar
          count={selectedQuestions.length}
          points={selectedPoints}
          hiddenCount={hiddenSelectedCount}
          busy={creatingTest}
          onCreate={() => void createTestFromSelection()}
          onClear={() => setSelectedIds(new Set())}
        />
      ) : null}

      {showDeleted && muzeMenit ? (
        <div className="mt-4 border-t border-line-soft pt-3">
          <h3 className="text-sm font-semibold text-fg-soft">Smazané otázky</h3>
          {loadingDeleted ? (
            <p className="mt-2 text-sm text-fg-muted">Načítám…</p>
          ) : (deletedQuestions?.length ?? 0) === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">Žádné smazané otázky.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line-soft">
              {deletedQuestions!.map((question) => (
                <li key={question.id} data-question-id={question.id} className="py-3">
                  <QuestionCard
                    topicId={topic.id}
                    question={question}
                    editing={false}
                    muzeMenit={muzeMenit}
                    selected={false}
                    busy={false}
                    usage={undefined}
                    onEditStart={() => {}}
                    onEditCancel={() => {}}
                    onEditSaved={() => {}}
                    onToggleSelect={() => {}}
                    onRegenerateDone={() => {}}
                    onRemove={() => {}}
                    deleted
                    restoring={restoringIds.has(question.id)}
                    onRestore={() => void restore(question)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </Card>
  )
})
