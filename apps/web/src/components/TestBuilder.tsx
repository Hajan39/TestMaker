'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, ResolvedTestItem, Template, Test } from '@testmaker/core/schema'
import { Button, PrintButton, Tabs, TabsContent, TabsList, TabsTrigger } from '@testmaker/ui'
import type { PickerTopic } from '@/lib/questionPicker'
import { BankPanel } from '@/components/test-builder/BankPanel'
import { TestOutline } from '@/components/test-builder/TestOutline'
import { RoughPreview } from '@/components/test-builder/RoughPreview'
import { TestSettings } from '@/components/test-builder/TestSettings'
import { formatPoints, nextDraftKey, type BankFilters, type DraftItem, type TestSettingsValue } from '@/components/test-builder/types'

const STRUCTURAL_TEXT: Record<'heading' | 'instruction' | 'page_break', string | null> = {
  heading: 'Nová část',
  instruction: 'Pokyn k vypracování',
  page_break: null,
}

/** Skládání testu. Drží stav, sloupce (banka / náhled / osnova) jsou řízené komponenty. */
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
  const [settings, setSettings] = useState<TestSettingsValue>(() => ({
    title: test?.title ?? '',
    description: test?.description ?? '',
    graded: test?.graded ?? true,
    templateId: test?.templateId ?? templates[0]?.id ?? '',
    header: test?.header ?? { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
    variants: test?.variants ?? 1,
    showKey: test?.showKey ?? true,
  }))
  const [draft, setDraft] = useState<DraftItem[]>(() =>
    items.map((item) => ({
      key: nextDraftKey(),
      kind: item.kind,
      questionId: item.questionId,
      text: item.text,
      pointsOverride: item.pointsOverride,
      question: item.question ?? null,
    })),
  )
  // Ve výchozím stavu jen schválené — do ostré písemky nemá proklouznout koncept.
  const [filters, setFilters] = useState<BankFilters>({
    search: '',
    subject: '',
    grade: '',
    type: '',
    onlyApproved: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(test?.id ?? null)

  const usedIds = useMemo(
    () => new Set(draft.filter((item) => item.questionId).map((item) => item.questionId as string)),
    [draft],
  )
  const totalPoints = draft.reduce(
    (sum, item) => (item.kind === 'question' ? sum + (item.pointsOverride ?? item.question?.points ?? 0) : sum),
    0,
  )
  const questionCount = draft.filter((item) => item.kind === 'question').length
  const template = templates.find((t) => t.id === settings.templateId) ?? templates[0] ?? null

  function toggleQuestion(question: Question) {
    setDraft((current) =>
      usedIds.has(question.id)
        ? current.filter((item) => item.questionId !== question.id)
        : [...current, { key: nextDraftKey(), kind: 'question', questionId: question.id, text: null, pointsOverride: null, question }],
    )
  }

  function addStructural(kind: 'heading' | 'instruction' | 'page_break') {
    setDraft((current) => [
      ...current,
      { key: nextDraftKey(), kind, questionId: null, text: STRUCTURAL_TEXT[kind], pointsOverride: null, question: null },
    ])
  }

  function reorder(from: number, to: number) {
    setDraft((current) => {
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved as DraftItem)
      return next
    })
  }

  function removeItem(key: string) {
    setDraft((current) => current.filter((item) => item.key !== key))
  }

  function patchItem(key: string, patch: Partial<DraftItem>) {
    setDraft((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)))
  }

  /** Otisk toho, co je opravdu uložené — porovnáním se pozná neuložená změna. */
  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        settings,
        items: draft.map((item) => ({
          kind: item.kind,
          questionId: item.questionId,
          text: item.text,
          pointsOverride: item.pointsOverride,
        })),
      }),
    [settings, draft],
  )
  const savedFingerprint = useRef<string | null>(test ? fingerprint : null)
  const dirty = savedFingerprint.current !== fingerprint

  // Zavření okna s rozpracovanou osnovou znamenalo ztrátu celé práce bez varování.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save() {
    setError(null)
    if (!settings.title.trim()) return setError('Vyplň název testu.')
    if (questionCount === 0) return setError('Přidej aspoň jednu otázku.')

    setSaving(true)
    const body = {
      ...(savedId ? { id: savedId } : {}),
      title: settings.title.trim(),
      description: settings.description.trim() || null,
      graded: settings.graded,
      templateId: settings.templateId,
      header: settings.header,
      variants: settings.variants,
      showKey: settings.showKey,
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
      savedFingerprint.current = fingerprint
      setSavedId(result.id)
      if (!test) router.replace(`/tests/${result.id}`)
      else router.refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  const bank = <BankPanel topics={topics} filters={filters} onFiltersChange={setFilters} usedIds={usedIds} onToggle={toggleQuestion} />
  const outline = (
    <TestOutline items={draft} graded={settings.graded} onReorder={reorder} onRemove={removeItem} onPatch={patchItem} onAdd={addStructural} />
  )
  const pdfHref = (variant: 'A' | 'B') => `/api/tests/${savedId}/pdf?variant=${variant}${settings.showKey ? '&key=1' : ''}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="ui-page-title">{test ? 'Úprava testu' : 'Nový test'}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-muted">
            {questionCount} otázek{settings.graded ? ` · ${formatPoints(totalPoints)} b.` : ''}
          </span>
          {savedId ? (
            <>
              <PrintButton href={pdfHref('A')}>Vytisknout</PrintButton>
              <a href={pdfHref('A')} target="_blank" rel="noreferrer">
                <Button size="sm" variant="outline">PDF varianta A</Button>
              </a>
              {settings.variants === 2 ? (
                <a href={pdfHref('B')} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline">PDF varianta B</Button>
                </a>
              ) : null}
            </>
          ) : null}
          <TestSettings value={settings} templates={templates} onChange={setSettings} />
          <Button disabled={saving} onClick={() => void save()}>{saving ? 'Ukládám…' : 'Uložit'}</Button>
        </div>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {/* Pod 1024 px: jeden sloupec se záložkami. */}
      <div className="lg:hidden">
        <Tabs defaultValue="banka">
          <TabsList>
            <TabsTrigger value="banka">Banka</TabsTrigger>
            <TabsTrigger value="osnova">Osnova</TabsTrigger>
          </TabsList>
          <TabsContent value="banka"><div className="h-[70vh]">{bank}</div></TabsContent>
          <TabsContent value="osnova"><div className="h-[70vh]">{outline}</div></TabsContent>
        </Tabs>
      </div>

      {/* 1024–1280 px: banka a osnova. Od 1280 px přibude náhled uprostřed. */}
      <div className="hidden gap-4 lg:grid lg:h-[70vh] lg:grid-cols-2 xl:grid-cols-3">
        <div className="min-h-0">{bank}</div>
        <div className="hidden min-h-0 xl:block">
          {template ? <RoughPreview items={draft} template={template} graded={settings.graded} title={settings.title} /> : null}
        </div>
        <div className="min-h-0">{outline}</div>
      </div>
    </div>
  )
}
