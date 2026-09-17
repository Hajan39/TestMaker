'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, ResolvedTestItem, Template, Test } from '@testmaker/core/schema'
import { Button, Input, Label, Tabs, TabsContent, TabsList, TabsTrigger, useMatchesMedia } from '@testmaker/ui'
import type { PickerTopic } from '@/lib/questionPicker'
import { PrintMenu } from '@/components/PrintMenu'
import { BankPanel } from '@/components/test-builder/BankPanel'
import { TestPage } from '@/components/test-builder/TestPage'
import { RandomDialog, type InsertMode } from '@/components/test-builder/RandomDialog'
import { TestSettings } from '@/components/test-builder/TestSettings'
import { nextDraftKey, type BankFilters, type DraftItem, type TestSettingsValue } from '@/components/test-builder/types'

const STRUCTURAL_TEXT: Record<'heading' | 'instruction' | 'page_break', string | null> = {
  heading: 'Nová část',
  instruction: 'Pokyn k vypracování',
  page_break: null,
}

/**
 * Skládání testu. Drží stav; oba sloupce — banka otázek vlevo a stránka
 * písemky vpravo — jsou řízené komponenty.
 *
 * Stránka je zároveň náhled i pracovní plocha: dřív se vedle sebe ukazoval
 * hrubý náhled a zvlášť osnova, takže učitelka skládala v jednom sloupci a
 * výsledek si domýšlela podle druhého.
 */
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
  const narrow = useMatchesMedia('(max-width: 1023.98px)')
  const [settings, setSettings] = useState<TestSettingsValue>(() => ({
    title: test?.title ?? '',
    description: test?.description ?? '',
    graded: test?.graded ?? true,
    templateId: test?.templateId ?? templates[0]?.id ?? '',
    header: test?.header ?? { school: '', subject: '', className: '', teacher: '', date: '', note: '' },
    variants: test?.variants ?? 1,
    // Klíč se už nenastavuje u testu, ale volí se až při tisku („Zadání pro
    // žáky" / „Klíč pro mě"). Sloupec v databázi zůstává, jen ho nic nemění.
    showKey: test?.showKey ?? true,
  }))
  const [draft, setDraft] = useState<DraftItem[]>(() =>
    items.map((item) => ({
      key: nextDraftKey(),
      id: item.id,
      kind: item.kind,
      questionId: item.questionId,
      text: item.text,
      pointsOverride: item.pointsOverride,
      linesOverride: item.linesOverride ?? null,
      question: item.question ?? null,
      questionEdited: item.questionEdited,
      questionMissing: item.questionMissing,
    })),
  )
  // Na stav otázky se tu nefiltruje: do banky jdou ze serveru jen schválené
  // otázky, takže do ostré písemky nemá koncept kudy proklouznout.
  const [filters, setFilters] = useState<BankFilters>({
    search: '',
    subject: '',
    grade: '',
    type: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(test?.id ?? null)
  // Chybějící název se dřív ohlásil u lišty, ale pole bylo schované v panelu
  // nastavení. Teď je pole v hlavičce a při chybě se na něj rovnou zaostří.
  const titleRef = useRef<HTMLInputElement>(null)
  const [titleInvalid, setTitleInvalid] = useState(false)

  /**
   * Kolikrát je která otázka v osnově. Táž otázka smí být v testu víckrát
   * (jednou jako rozcvička, podruhé v jiné části), proto se počítá, ne jen
   * eviduje přítomnost.
   */
  const usedCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of draft) {
      if (!item.questionId) continue
      counts.set(item.questionId, (counts.get(item.questionId) ?? 0) + 1)
    }
    return counts
  }, [draft])
  const questionCount = draft.filter((item) => item.kind === 'question').length
  const template = templates.find((t) => t.id === settings.templateId) ?? templates[0] ?? null

  function questionItem(question: Question): DraftItem {
    return {
      key: nextDraftKey(),
      id: null,
      kind: 'question',
      questionId: question.id,
      text: null,
      pointsOverride: null,
      linesOverride: null,
      question,
    }
  }

  /** Další výskyt téže otázky na konci osnovy — ostatní výskyty zůstávají. */
  function addQuestion(question: Question) {
    setDraft((current) => [...current, questionItem(question)])
  }

  /** Zaškrtávátko v bance: buď otázku přidá, nebo vyhodí všechny její výskyty. */
  function toggleQuestion(question: Question) {
    setDraft((current) =>
      usedCounts.has(question.id)
        ? current.filter((item) => item.questionId !== question.id)
        : [...current, questionItem(question)],
    )
  }

  /**
   * Zaškrtnutí celé skupiny. Přidávají se jen otázky, které v osnově ještě
   * nejsou, aby se hromadným výběrem nezdvojily už vybrané; odebírání naopak
   * vyhodí celou skupinu naráz.
   */
  function toggleMany(list: Question[], add: boolean) {
    setDraft((current) => {
      if (!add) {
        const removed = new Set(list.map((question) => question.id))
        return current.filter((item) => !item.questionId || !removed.has(item.questionId))
      }
      const present = new Set(current.map((item) => item.questionId).filter(Boolean) as string[])
      const added = list.filter((question) => !present.has(question.id)).map(questionItem)
      return [...current, ...added]
    })
  }

  /**
   * Vylosovaný test do osnovy. Rozpracovaná osnova se nesmí ztratit potichu:
   * `append` přidá vylosované na konec, `replace` nahradí celou osnovu, a
   * učitelka si v dialogu vybírá, co z toho. Uloženo není nic — na to je
   * pořád tlačítko Uložit.
   */
  function insertRandom(questions: Question[], mode: InsertMode) {
    setDraft((current) => {
      const added = questions.map(questionItem)
      return mode === 'replace' ? added : [...current, ...added]
    })
  }

  /**
   * Nadpis, pokyn i zalomení strany jde vložit kamkoli: `index` je místo, kam
   * položka přijde (0 = úplně nahoru). Bez něj se připojí na konec.
   */
  function addStructural(kind: 'heading' | 'instruction' | 'page_break', index?: number) {
    setDraft((current) => {
      const item: DraftItem = {
        key: nextDraftKey(),
        id: null,
        kind,
        questionId: null,
        text: STRUCTURAL_TEXT[kind],
        pointsOverride: null,
        linesOverride: null,
        question: null,
      }
      const at = Math.min(Math.max(index ?? current.length, 0), current.length)
      const next = [...current]
      next.splice(at, 0, item)
      return next
    })
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
          linesOverride: item.linesOverride,
        })),
      }),
    [settings, draft],
  )
  // Otisk naposledy uloženého stavu. Ve stavu, ne v ref — ref se během
  // vykreslování nemá číst a React na to upozorňuje.
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(test ? fingerprint : null)
  const dirty = savedFingerprint !== fingerprint

  // Zavření okna s rozpracovanou osnovou znamenalo ztrátu celé práce bez varování.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  async function save() {
    setError(null)
    setTitleInvalid(false)
    if (!settings.title.trim()) {
      setTitleInvalid(true)
      titleRef.current?.focus()
      return setError('Vyplň název písemky.')
    }
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
        id: item.id,
        kind: item.kind,
        questionId: item.questionId,
        text: item.text,
        pointsOverride: item.pointsOverride,
        linesOverride: item.linesOverride,
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
      setSavedFingerprint(fingerprint)
      setSavedId(result.id)
      if (!test) router.replace(`/tests/${result.id}`)
      else router.refresh()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setSaving(false)
    }
  }

  const bank = (
    <BankPanel
      topics={topics}
      filters={filters}
      onFiltersChange={setFilters}
      usedCounts={usedCounts}
      onToggle={toggleQuestion}
      onAddAgain={addQuestion}
      onToggleMany={toggleMany}
    />
  )
  const sheet = (
    <TestPage
      items={draft}
      title={settings.title}
      description={settings.description}
      header={settings.header}
      graded={settings.graded}
      template={template}
      onReorder={reorder}
      onRemove={removeItem}
      onPatch={patchItem}
      onAdd={addStructural}
    />
  )
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* Název není nastavení mezi ostatními: bez něj se test neuloží, takže
            patří do hlavičky na oči, ne do panelu, který se ani neotevře. */}
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="ui-page-title">{test ? 'Úprava testu' : 'Nový test'}</h1>
          <div className="mt-2 max-w-md">
            <Label htmlFor="test-title">Název písemky</Label>
            <Input
              id="test-title"
              ref={titleRef}
              value={settings.title}
              placeholder="Např. Čtvrtletní písemka – přírodopis"
              aria-invalid={titleInvalid || undefined}
              aria-describedby={titleInvalid ? 'test-title-error' : undefined}
              onChange={(event) => {
                setTitleInvalid(false)
                setSettings({ ...settings, title: event.target.value })
              }}
            />
          </div>
        </div>
        {/* Počty (otázek, bodů, odhad stran) se čtou na jediném místě — v patičce
            pod stránkou písemky, kde vznikají. V liště nahoře stálo totéž ještě
            jednou a obě čísla se musela hlídat, aby si neodporovala. */}
        <div className="flex flex-wrap items-center gap-2">
          {savedId ? <PrintMenu testId={savedId} variants={settings.variants} /> : null}
          <RandomDialog topics={topics} hasDraft={draft.length > 0} onInsert={insertRandom} />
          <TestSettings value={settings} templates={templates} onChange={setSettings} />
          <Button disabled={saving} onClick={() => void save()}>{saving ? 'Ukládám…' : 'Uložit'}</Button>
        </div>
      </div>

      {error ? (
        <p id="test-title-error" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {/* Vykresluje se jen jedna podoba. Obě naráz (jedna schovaná) znamenaly
          zdvojená `id` filtrů a zdvojené zaškrtávátko „Vybrat vše". */}
      {narrow ? (
        // Pod 1024 px: jeden sloupec se záložkami.
        <Tabs defaultValue="banka">
          <TabsList>
            <TabsTrigger value="banka">Banka</TabsTrigger>
            <TabsTrigger value="stranka">Stránka</TabsTrigger>
          </TabsList>
          <TabsContent value="banka"><div className="h-[70vh]">{bank}</div></TabsContent>
          <TabsContent value="stranka"><div className="h-[70vh]">{sheet}</div></TabsContent>
        </Tabs>
      ) : (
        // Od 1024 px vedle sebe: banka vlevo, stránka vpravo. Stránka dostane
        // víc místa — je na ní vidět, jak se písemka vytiskne, a pracuje se na ní.
        <div className="grid h-[70vh] gap-4 grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="min-h-0">{bank}</div>
          <div className="min-h-0">{sheet}</div>
        </div>
      )}
    </div>
  )
}
