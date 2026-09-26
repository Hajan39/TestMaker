'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, QuestionType } from '@testmaker/core/schema'
import { QUESTION_TYPE_LABELS } from '@testmaker/core/schema'
import {
  Button,
  Card,
  EmptyState,
  Label,
  QuestionPreview,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@testmaker/ui'
import { QuestionEditorForm } from '@/components/QuestionEditor'
import { RegenerateButton } from '@/components/RegenerateButton'
import { useMuzeMenit } from '@/components/Prava'
import { rejectQuestions, restoreStatuses } from '@/lib/questionStatusClient'

interface Filters {
  type: QuestionType | ''
  difficulty: 1 | 2 | 3 | ''
}

/**
 * Otázky tématu jako karty: úprava přímo na místě, přegenerování, smazání
 * s vrácením a přidání vlastní — bez fronty ke schválení, ta v tématu končí.
 *
 * Karta rozpracované úpravy se drží podle `id` otázky, ne podle pozice v poli
 * `questions` — to se mění s každým `router.refresh()` (dogenerování,
 * smazání jiné karty), ale rozepsaná úprava zůstává otevřená dál.
 */
export function TopicQuestions({ topicId, questions }: { topicId: string; questions: Question[] }) {
  const router = useRouter()
  const muzeMenit = useMuzeMenit()
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Smazaná (i přegenerovaná) karta zmizí hned, bez čekání na obnovení seznamu
  // ze serveru — tahle množina je jediné místo, kde se to pozná.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  // Otázka, u které se právě maže — chrání proti dvojímu kliknutí, než dojde
  // odpověď ze serveru (smazání je optimistické, karta zmizí ještě dřív).
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [filters, setFilters] = useState<Filters>({ type: '', difficulty: '' })

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
    return true
  })

  function resetFilters() {
    setFilters({ type: '', difficulty: '' })
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
            topicId={topicId}
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
              {editingId === question.id ? (
                <QuestionEditorForm
                  topicId={topicId}
                  question={question}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null)
                    router.refresh()
                  }}
                />
              ) : (
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <QuestionPreview question={question} />
                  </div>
                  {muzeMenit ? (
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(question.id)}>
                        Upravit
                      </Button>
                      <RegenerateButton
                        questionId={question.id}
                        type={question.type}
                        onDone={() => setHiddenIds((current) => new Set(current).add(question.id))}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-danger hover:text-danger"
                        disabled={busyIds.has(question.id)}
                        onClick={() => void remove(question)}
                      >
                        Smazat
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
