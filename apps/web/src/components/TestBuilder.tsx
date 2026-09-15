'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, ResolvedTestItem, Template, Test, TestItemKind } from '@testmaker/core/schema'
import { QUESTION_TYPE_LABELS, type QuestionType } from '@testmaker/core/schema'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  Label,
  QuestionPreview,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@testmaker/ui'
import { TemplatePreview } from '@/components/TemplatePreview'
import type { PickerTopic } from '@/lib/questionPicker'

interface DraftItem {
  key: string
  kind: TestItemKind
  questionId: string | null
  text: string | null
  pointsOverride: number | null
  question: Question | null
}

let keyCounter = 0
const nextKey = () => `item-${(keyCounter += 1)}`

export function TestBuilder({
  topics,
  templates,
  test,
  items,
}: {
  topics: PickerTopic[]
  templates: Template[]
  test: Test | null
  items: ResolvedTestItem[]
}) {
  const router = useRouter()
  const [title, setTitle] = useState(test?.title ?? '')
  const [description, setDescription] = useState(test?.description ?? '')
  const [graded, setGraded] = useState(test?.graded ?? true)
  const [templateId, setTemplateId] = useState(test?.templateId ?? templates[0]?.id ?? '')
  const [variants, setVariants] = useState<1 | 2>(test?.variants ?? 1)
  const [showKey, setShowKey] = useState(test?.showKey ?? true)
  const [header, setHeader] = useState(
    test?.header ?? { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
  )
  const [draft, setDraft] = useState<DraftItem[]>(() =>
    items.map((item) => ({
      key: nextKey(),
      kind: item.kind,
      questionId: item.questionId,
      text: item.text,
      pointsOverride: item.pointsOverride,
      question: item.question ?? null,
    })),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(test?.id ?? null)
  const [filters, setFilters] = useState<{ subject: string; type: QuestionType | ''; search: string; onlyApproved: boolean }>({
    subject: '',
    type: '',
    search: '',
    onlyApproved: false,
  })

  const usedIds = useMemo(
    () => new Set(draft.filter((item) => item.questionId).map((item) => item.questionId as string)),
    [draft],
  )

  const subjects = useMemo(() => [...new Set(topics.map((topic) => topic.subject))].sort(), [topics])

  const visibleTopics = useMemo(() => {
    const needle = filters.search.trim().toLocaleLowerCase('cs')
    return topics
      .filter((topic) => !filters.subject || topic.subject === filters.subject)
      .map((topic) => ({
        ...topic,
        questions: topic.questions.filter((question) => {
          if (filters.type && question.type !== filters.type) return false
          if (filters.onlyApproved && question.status !== 'approved') return false
          if (needle) {
            const haystack = `${topic.label} ${JSON.stringify(question.payload)}`.toLocaleLowerCase('cs')
            if (!haystack.includes(needle)) return false
          }
          return true
        }),
      }))
      .filter((topic) => topic.questions.length > 0)
  }, [topics, filters])

  const totalPoints = draft.reduce(
    (sum, item) =>
      item.kind === 'question' ? sum + (item.pointsOverride ?? item.question?.points ?? 0) : sum,
    0,
  )
  const questionCount = draft.filter((item) => item.kind === 'question').length

  function addQuestion(question: Question) {
    if (usedIds.has(question.id)) return
    setDraft((current) => [
      ...current,
      { key: nextKey(), kind: 'question', questionId: question.id, text: null, pointsOverride: null, question },
    ])
  }

  function addStructural(kind: Exclude<TestItemKind, 'question'>) {
    setDraft((current) => [
      ...current,
      {
        key: nextKey(),
        kind,
        questionId: null,
        text: kind === 'heading' ? 'Nová část' : kind === 'instruction' ? 'Pokyn k vypracování' : null,
        pointsOverride: null,
        question: null,
      },
    ])
  }

  function move(index: number, delta: number) {
    setDraft((current) => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved as DraftItem)
      return next
    })
  }

  async function save() {
    setError(null)
    if (!title.trim()) {
      setError('Vyplň název testu.')
      return
    }
    if (questionCount === 0) {
      setError('Přidej aspoň jednu otázku.')
      return
    }

    setSaving(true)
    const body = {
      ...(savedId ? { id: savedId } : {}),
      title: title.trim(),
      description: description.trim() || null,
      graded,
      templateId,
      header,
      variants,
      showKey,
      items: draft.map((item) => ({
        kind: item.kind,
        questionId: item.questionId,
        text: item.text,
        pointsOverride: item.pointsOverride,
      })),
    }

    try {
      const response = await fetch('/api/tests', {
        method: savedId ? 'PUT' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(detail.error ?? `Uložení selhalo (${response.status})`)
      }
      const result = (await response.json()) as { id: string }
      setSavedId(result.id)
      if (!test) router.replace(`/tests/${result.id}`)
      else router.refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-fg">{test ? 'Úprava testu' : 'Nový test'}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-muted">
            {questionCount} otázek{graded ? ` · ${formatPoints(totalPoints)} b.` : ''}
          </span>
          {savedId ? (
            <>
              <a href={`/api/tests/${savedId}/pdf?variant=A${showKey ? '&key=1' : ''}`} target="_blank" rel="noreferrer">
                <Button size="sm" variant="outline">
                  PDF varianta A
                </Button>
              </a>
              {variants === 2 ? (
                <a href={`/api/tests/${savedId}/pdf?variant=B${showKey ? '&key=1' : ''}`} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline">
                    PDF varianta B
                  </Button>
                </a>
              ) : null}
            </>
          ) : null}
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? 'Ukládám…' : 'Uložit'}
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <Label htmlFor="test-title">Název testu</Label>
            <Input
              id="test-title"
              value={title}
              placeholder="Např. Čtvrtletní písemka – přírodopis"
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="test-variants">Varianty</Label>
            <Select value={String(variants)} onValueChange={(value) => setVariants(value === '2' ? 2 : 1)}>
              <SelectTrigger id="test-variants" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Jen A</SelectItem>
                <SelectItem value="2">A i B (přeházené pořadí)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Label htmlFor="test-description">Podtitul / úvodní věta (nepovinné)</Label>
            <Input id="test-description" value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="test-header-school">Škola</Label>
            <Input
              id="test-header-school"
              value={header.school}
              onChange={(event) => setHeader({ ...header, school: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="test-header-subject">Předmět</Label>
            <Input
              id="test-header-subject"
              value={header.subject}
              onChange={(event) => setHeader({ ...header, subject: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="test-header-class">Třída</Label>
            <Input
              id="test-header-class"
              value={header.className}
              placeholder="prázdné = linka k doplnění"
              onChange={(event) => setHeader({ ...header, className: event.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="test-header-date">Datum</Label>
            <Input
              id="test-header-date"
              value={header.date}
              placeholder="prázdné = linka k doplnění"
              onChange={(event) => setHeader({ ...header, date: event.target.value })}
            />
          </div>
        </div>

        <div className="mt-4">
          <Label>Šablona</Label>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => setTemplateId(template.id)}
                className={
                  'rounded-lg border p-1.5 text-left transition-colors ' +
                  (template.id === templateId
                    ? 'border-brand bg-brand-bg'
                    : 'border-line hover:border-fg-muted')
                }
              >
                <TemplatePreview templateId={template.id} graded={graded} />
                <span className="mt-1.5 block px-1 text-sm font-medium text-fg-soft">{template.name}</span>
                <span className="block px-1 pb-1 text-xs text-fg-muted">{template.description}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm text-fg-soft">
            <Checkbox checked={graded} onCheckedChange={() => setGraded(!graded)} />
            Test na známky (tiskne body a políčko na známku)
          </label>
          <label className="flex items-center gap-2 text-sm text-fg-soft">
            <Checkbox checked={showKey} onCheckedChange={() => setShowKey(!showKey)} />
            Přiložit klíč správných odpovědí
          </label>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-fg">Banka otázek</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Vybírej napříč předměty i ročníky — hodí se pro čtvrtletky a opakování z loňska.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <div className="w-40">
              <Label htmlFor="bank-subject-filter">Předmět</Label>
              <Select
                value={filters.subject || 'vse'}
                onValueChange={(value) => setFilters({ ...filters, subject: value === 'vse' ? '' : value })}
              >
                <SelectTrigger id="bank-subject-filter" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vse">Všechny</SelectItem>
                  {subjects.map((subject) => (
                    <SelectItem key={subject} value={subject}>
                      {subject}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-44">
              <Label htmlFor="bank-type-filter">Typ</Label>
              <Select
                value={filters.type || 'vse'}
                onValueChange={(value) =>
                  setFilters({ ...filters, type: value === 'vse' ? '' : (value as QuestionType) })
                }
              >
                <SelectTrigger id="bank-type-filter" className="w-full">
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
            <div className="w-44">
              <Label htmlFor="bank-search-filter">Hledat</Label>
              <Input
                id="bank-search-filter"
                value={filters.search}
                onChange={(event) => setFilters({ ...filters, search: event.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-fg-soft">
              <Checkbox
                checked={filters.onlyApproved}
                onCheckedChange={() => setFilters({ ...filters, onlyApproved: !filters.onlyApproved })}
              />
              jen schválené
            </label>
          </div>

          <div className="mt-3 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
            {visibleTopics.length === 0 ? (
              <EmptyState title="Žádné otázky neodpovídají filtru" />
            ) : (
              visibleTopics.map((topic) => (
                <details key={topic.id} className="rounded border border-line-soft">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-fg-soft">
                    {topic.label}{' '}
                    <span className="font-normal text-fg-muted">({topic.questions.length})</span>
                  </summary>
                  <ul className="divide-y divide-line-soft px-3 pb-2">
                    {topic.questions.map((question) => (
                      <li key={question.id} className="flex gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <QuestionPreview question={question} showAnswers={false} />
                        </div>
                        <Button
                          size="sm"
                          variant={usedIds.has(question.id) ? 'ghost' : 'outline'}
                          disabled={usedIds.has(question.id)}
                          onClick={() => addQuestion(question)}
                        >
                          {usedIds.has(question.id) ? 'v testu' : 'Přidat'}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </details>
              ))
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-fg">Obsah testu</h2>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" onClick={() => addStructural('heading')}>
                + Nadpis části
              </Button>
              <Button size="sm" variant="outline" onClick={() => addStructural('instruction')}>
                + Pokyn
              </Button>
              <Button size="sm" variant="outline" onClick={() => addStructural('page_break')}>
                + Nová strana
              </Button>
            </div>
          </div>

          {draft.length === 0 ? (
            <div className="mt-3">
              <EmptyState title="Test je prázdný" hint="Přidej otázky z banky vlevo." />
            </div>
          ) : (
            <ol className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
              {draft.map((item, index) => (
                <li key={item.key} className="rounded border border-line-soft p-2">
                  <div className="flex items-start gap-2">
                    <div className="flex flex-col gap-0.5">
                      <Button size="sm" variant="ghost" onClick={() => move(index, -1)} aria-label="Nahoru">
                        ↑
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => move(index, 1)} aria-label="Dolů">
                        ↓
                      </Button>
                    </div>
                    <div className="min-w-0 flex-1">
                      {item.kind === 'question' && item.question ? (
                        <QuestionPreview question={item.question} />
                      ) : item.kind === 'page_break' ? (
                        <p className="py-2 text-sm text-fg-muted">— zalomení strany —</p>
                      ) : (
                        <div>
                          <Badge variant="secondary">{item.kind === 'heading' ? 'nadpis části' : 'pokyn'}</Badge>
                          <Input
                            className="mt-1"
                            value={item.text ?? ''}
                            onChange={(event) =>
                              setDraft((current) =>
                                current.map((entry) =>
                                  entry.key === item.key ? { ...entry, text: event.target.value } : entry,
                                ),
                              )
                            }
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {item.kind === 'question' && graded ? (
                        <Input
                          className="w-20"
                          type="number"
                          min={0}
                          step={0.5}
                          value={item.pointsOverride ?? item.question?.points ?? 0}
                          onChange={(event) =>
                            setDraft((current) =>
                              current.map((entry) =>
                                entry.key === item.key
                                  ? { ...entry, pointsOverride: Number(event.target.value) || 0 }
                                  : entry,
                              ),
                            )
                          }
                        />
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDraft((current) => current.filter((entry) => entry.key !== item.key))}
                      >
                        Odebrat
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  )
}

function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1).replace('.', ',')
}
