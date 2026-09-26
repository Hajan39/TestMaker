'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, QuestionStatus } from '@testmaker/core/schema'
import {
  BusyButton,
  Card,
  EmptyState,
  Label,
  OTAZKY,
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

/** Kolik otázek se natáhne jednou stránkou. Fronta jich může mít přes tisíc. */
const PAGE_SIZE = 20
/** Jak daleko před koncem načteného okna se sáhne pro další stránku. */
const PREFETCH_AHEAD = 8
/** Od kolikáté odbavené otázky se okno ořízne zepředu, ať v paměti neroste donekonečna. */
const TRIM_AFTER = 60
const TRIM_BY = 40
/** Kolik identifikátorů nejvíc pojme jeden požadavek při vracení hromadné akce. */
const UNDO_CHUNK = 200

export interface ReviewScope {
  subjectId: string
  gradeId: string
  topicId: string
}

interface TopicOption {
  id: string
  name: string
  gradeId: string
  subjectId: string
  label: string
}

/** Zápis stavu po dávkách — jeden požadavek nemá nést tisíc identifikátorů. */
async function writeStatus(ids: string[], status: QuestionStatus): Promise<void> {
  for (let start = 0; start < ids.length; start += UNDO_CHUNK) {
    const response = await fetch('/api/questions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ids.slice(start, start + UNDO_CHUNK), status }),
    })
    if (!response.ok) throw new Error('Stav otázky se nepodařilo uložit')
  }
}

/**
 * Kontrola konceptů přes celou knihovnu: nahoře zúžení na předmět, ročník
 * nebo téma, pod ním fronta.
 *
 * Postup („zbývá ke kontrole X") drží tahle vnější vrstva, aby ho přežilo
 * i znovunačtení fronty. Fronta samotná je `ReviewFeed` s klíčem podle filtru
 * — změnou filtru se vymění celá, takže se nemusí ručně uklízet rozdělaný
 * stav kurzoru.
 */
export function ReviewScreen({
  subjects,
  grades,
  topics,
  initialScope,
  pending,
  aiConfigured,
}: {
  subjects: { id: string; name: string }[]
  grades: { id: string; name: string; subjectId: string }[]
  topics: TopicOption[]
  initialScope: ReviewScope
  /** Kolik konceptů čeká v celé knihovně — než fronta nahlásí vlastní počet. */
  pending: number
  aiConfigured: boolean
}) {
  const router = useRouter()
  const [scope, setScope] = useState<ReviewScope>(initialScope)
  const [approved, setApproved] = useState(0)
  const [remaining, setRemaining] = useState(pending)
  const [bulkPending, setBulkPending] = useState(false)
  // Změna tohohle čísla frontu přemontuje — po hromadné akci nebo úpravě
  // otázky se načte znovu od začátku.
  const [reloadKey, setReloadKey] = useState(0)

  const scopeKey = `${scope.subjectId}|${scope.gradeId}|${scope.topicId}`

  /** Přepnutí filtru: fronta i postup začínají znovu. */
  function changeScope(next: ReviewScope) {
    setScope(next)
    setApproved(0)
  }

  /** Vrácení hromadné akce po dávkách — otázky mohly mít různé předchozí stavy. */
  async function undoBulk(previous: [string, QuestionStatus][]) {
    try {
      for (const step of planUndo(previous)) await writeStatus(step.ids, step.status)
      toast.success(`Vráceno zpět: ${pocet(previous.length, OTAZKY)}`)
      setApproved((value) => Math.max(0, value - previous.length))
      setRemaining((value) => value + previous.length)
      setReloadKey((value) => value + 1)
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Vrácení se nepodařilo')
    }
  }

  /**
   * Schválí všechny koncepty vybraného tématu. Neposílá se tisíc
   * identifikátorů — stačí id tématu a výchozí stav.
   */
  async function approveWholeTopic() {
    if (!scope.topicId) return
    setBulkPending(true)
    try {
      const response = await fetch('/api/questions', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topicId: scope.topicId, from: 'draft', status: 'approved' }),
      })
      if (!response.ok) throw new Error('Téma se nepodařilo schválit')
      const { updated, ids } = (await response.json()) as { updated: number; ids: string[] }
      if (updated === 0) {
        toast('V tomhle tématu už žádné koncepty nezbyly.')
        return
      }
      setApproved((value) => value + updated)
      setRemaining((value) => Math.max(0, value - updated))
      setReloadKey((value) => value + 1)
      router.refresh()
      toast.success(`Schváleno ${pocet(updated, OTAZKY)} v tématu`, {
        duration: 10_000,
        action: {
          label: 'Vzít zpět',
          onClick: () => void undoBulk(ids.map((id): [string, QuestionStatus] => [id, 'draft'])),
        },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Téma se nepodařilo schválit')
    } finally {
      setBulkPending(false)
    }
  }

  const visibleGrades = useMemo(
    () => grades.filter((grade) => !scope.subjectId || grade.subjectId === scope.subjectId),
    [grades, scope.subjectId],
  )
  const visibleTopics = useMemo(
    () =>
      topics.filter((topic) => {
        if (scope.gradeId) return topic.gradeId === scope.gradeId
        if (scope.subjectId) return topic.subjectId === scope.subjectId
        return true
      }),
    [topics, scope.gradeId, scope.subjectId],
  )

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h1 className="ui-page-title">Kontrola konceptů</h1>
          {scope.topicId ? (
            <BusyButton
              size="sm"
              variant="outline"
              busy={bulkPending}
              busyLabel="Schvaluji…"
              onClick={() => void approveWholeTopic()}
            >
              Schválit celé téma
            </BusyButton>
          ) : null}
        </div>

        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <Label htmlFor="review-subject">Předmět</Label>
              <Select
                value={scope.subjectId || 'vse'}
                onValueChange={(value) =>
                  changeScope({ subjectId: value === 'vse' ? '' : value, gradeId: '', topicId: '' })
                }
              >
                <SelectTrigger id="review-subject" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vse">Celá knihovna</SelectItem>
                  {subjects.map((subject) => (
                    <SelectItem key={subject.id} value={subject.id}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-40">
              <Label htmlFor="review-grade">Ročník</Label>
              <Select
                value={scope.gradeId || 'vse'}
                onValueChange={(value) => {
                  if (value === 'vse') changeScope({ ...scope, gradeId: '', topicId: '' })
                  else {
                    const grade = grades.find((item) => item.id === value)
                    changeScope({
                      subjectId: grade?.subjectId ?? scope.subjectId,
                      gradeId: value,
                      topicId: '',
                    })
                  }
                }}
              >
                <SelectTrigger id="review-grade" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vse">Všechny</SelectItem>
                  {visibleGrades.map((grade) => (
                    <SelectItem key={grade.id} value={grade.id}>
                      {grade.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-56 flex-1">
              <Label htmlFor="review-topic">Téma</Label>
              <Select
                value={scope.topicId || 'vse'}
                onValueChange={(value) => {
                  if (value === 'vse') changeScope({ ...scope, topicId: '' })
                  else {
                    const topic = topics.find((item) => item.id === value)
                    changeScope({
                      subjectId: topic?.subjectId ?? scope.subjectId,
                      gradeId: topic?.gradeId ?? scope.gradeId,
                      topicId: value,
                    })
                  }
                }}
              >
                <SelectTrigger id="review-topic" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vse">Všechna</SelectItem>
                  {visibleTopics.map((topic) => (
                    <SelectItem key={topic.id} value={topic.id}>
                      {topic.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="mt-3 text-sm text-fg-muted">
            Klávesy: <strong>A</strong> schválit, <strong>X</strong> zamítnout, <strong>E</strong> upravit,
            {aiConfigured ? (
              <>
                {' '}
                <strong>N</strong> nahradit modelem,
              </>
            ) : null}{' '}
            <strong>→</strong> přeskočit.
          </p>
        </Card>

        <ReviewFeed
          key={`${scopeKey}|${reloadKey}`}
          scope={scope}
          aiConfigured={aiConfigured}
          approved={approved}
          remaining={remaining}
          onTotal={setRemaining}
          onDecided={(status) => {
            setRemaining((value) => Math.max(0, value - 1))
            if (status === 'approved') setApproved((value) => value + 1)
          }}
          onReload={() => setReloadKey((value) => value + 1)}
        />
      </div>
    </div>
  )
}

/**
 * Samotná fronta: drží okno načtených otázek a dotahuje další stránky.
 *
 * Nikdy nemá v paměti celou frontu — ta může mít přes tisíc položek. Načítá
 * se po stránkách kurzorem (offset by po schválení přeskakoval) a okno se
 * zepředu ořezává, jak jím učitelka projíždí.
 */
function ReviewFeed({
  scope,
  aiConfigured,
  approved,
  remaining,
  onTotal,
  onDecided,
  onReload,
}: {
  scope: ReviewScope
  aiConfigured: boolean
  approved: number
  remaining: number
  onTotal: (total: number) => void
  onDecided: (status: 'approved' | 'rejected') => void
  onReload: () => void
}) {
  const router = useRouter()
  const [items, setItems] = useState<Question[]>([])
  const [position, setPosition] = useState(0)
  // `loading` znamená „první stránka ještě nedorazila"; dalších stránek si
  // učitelka nevšimne, načítají se s předstihem.
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [finished, setFinished] = useState(false)
  const [editing, setEditing] = useState<Question | null>(null)

  // O načítání rozhodují zpětná volání z fronty (klávesnice), která by jinak
  // viděla hodnoty z okamžiku svého vzniku.
  const cursorRef = useRef<string | null>(null)
  const hasMoreRef = useRef(true)
  const loadingRef = useRef(false)
  const zivyRef = useRef(true)
  /**
   * Dorazila první stránka? Dokud ne, nesmí si o další nikdo říct — jinak by
   * dotažení „další" stránky předběhlo to úplně první načtení, a s ním i
   * zjištění, kolik otázek vlastně ve frontě čeká.
   */
  const prvniHotovaRef = useRef(false)

  const loadPage = useCallback(
    async (first = false) => {
      if (loadingRef.current) return
      if (!first && (!prvniHotovaRef.current || !hasMoreRef.current)) return
      loadingRef.current = true
      try {
        const params = new URLSearchParams({ status: 'draft', limit: String(PAGE_SIZE) })
        if (scope.topicId) params.set('topicId', scope.topicId)
        else if (scope.gradeId) params.set('gradeId', scope.gradeId)
        else if (scope.subjectId) params.set('subjectId', scope.subjectId)
        const cursor = first ? null : cursorRef.current
        if (cursor) params.set('cursor', cursor)

        const response = await fetch(`/api/questions?${params.toString()}`)
        if (!response.ok) throw new Error('Frontu se nepodařilo načíst')
        const data = (await response.json()) as {
          items: Question[]
          nextCursor: string | null
          total: number
        }
        if (!zivyRef.current) return

        cursorRef.current = data.nextCursor
        hasMoreRef.current = data.nextCursor !== null
        if (first) {
          prvniHotovaRef.current = true
          onTotal(data.total)
          if (data.items.length === 0) setFinished(true)
        }
        setItems((current) => {
          const known = new Set(current.map((item) => item.id))
          return first ? data.items : [...current, ...data.items.filter((item) => !known.has(item.id))]
        })
      } catch (error) {
        if (zivyRef.current) {
          toast.error(error instanceof Error ? error.message : 'Frontu se nepodařilo načíst')
        }
      } finally {
        loadingRef.current = false
        if (zivyRef.current) setLoading(false)
      }
    },
    [scope.topicId, scope.gradeId, scope.subjectId, onTotal],
  )

  useEffect(() => {
    zivyRef.current = true
    // Načtení se rozjede až za tímhle překreslením: stav se nemá měnit
    // synchronně v efektu (React to hlásí jako řetězení překreslení),
    // stejně jako to dělá vyhledávání v knihovně.
    void Promise.resolve().then(() => loadPage(true))
    return () => {
      zivyRef.current = false
    }
    // Fronta se montuje znovu při každé změně filtru (klíč komponenty).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Další stránka se dotahuje dřív, než fronta dojede na konec okna.
  useEffect(() => {
    if (loading) return
    if (hasMoreRef.current && items.length - position <= PREFETCH_AHEAD) void loadPage()
  }, [items, position, loading, loadPage])

  function decide(id: string, status: 'approved' | 'rejected') {
    setItems((current) => current.filter((item) => item.id !== id))
    onDecided(status)
    void writeStatus([id], status).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Stav otázky se nepodařilo uložit')
    })
  }

  /**
   * Fronta hlásí, na kolikáté otázce okna stojí. Podle toho se ořezává začátek
   * okna — dál dozadu se učitelka nevrací a držet v paměti tisíc otázek nemá smysl.
   */
  function handlePosition(index: number) {
    setPosition(index)
    if (index >= TRIM_AFTER) setItems((current) => current.slice(TRIM_BY))
  }

  /**
   * Fronta došla. Když se ještě načítá další stránka, není to konec — jen jsme
   * dojeli na okraj okna a čekáme na data.
   */
  function handleClose() {
    if (hasMoreRef.current || loadingRef.current) return
    setFinished(true)
  }

  /**
   * Náhrada otázky modelem. Na serveru nejdřív vznikne nová otázka a teprve
   * pak se původní označí jako zamítnutá — když model selže, nezmění se nic.
   * V okně proto stačí jednu otázku vyměnit za druhou a počet zbývajících se
   * nemění (jeden koncept odešel, jeden přišel).
   */
  async function regenerate(id: string) {
    setBusy(true)
    try {
      const response = await fetch('/api/questions/regenerate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = (await response.json()) as { question?: Question; error?: string }
      if (!response.ok || !data.question) {
        toast.error(data.error ?? 'Náhradu se nepodařilo vytvořit')
        return
      }
      const replacement = data.question
      setItems((current) => current.map((item) => (item.id === id ? replacement : item)))
      toast.success('Otázka nahrazena novou.')
      router.refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Náhradu se nepodařilo vytvořit')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card className="p-4" data-review-queue="">
        {items.length > 0 ? (
          <ReviewQueue
            questions={items}
            overall={{ approved, remaining }}
            busy={busy}
            onPosition={handlePosition}
            onApprove={(id) => decide(id, 'approved')}
            onReject={(id) => decide(id, 'rejected')}
            onEdit={(id) => {
              const question = items.find((item) => item.id === id)
              if (question) setEditing(question)
            }}
            onRegenerate={aiConfigured ? (id) => void regenerate(id) : undefined}
            onClose={handleClose}
          />
        ) : loading ? (
          <p className="text-sm text-fg-muted">Načítám frontu…</p>
        ) : (
          <EmptyState
            title={finished && approved > 0 ? 'Hotovo, ke kontrole nic nezbývá' : 'Ke kontrole nic nezbývá'}
            hint={
              approved > 0
                ? `V tomhle sezení jsi zkontrolovala ${pocet(approved, OTAZKY)}.`
                : 'Koncepty vznikají generováním z materiálů tématu.'
            }
          />
        )}
      </Card>

      {editing && editing.topicId ? (
        <QuestionEditor
          topicId={editing.topicId}
          question={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onReload()
          }}
        />
      ) : null}
    </>
  )
}
