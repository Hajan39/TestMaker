'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Question, QuestionContent, ResolvedTestItem, Template, Test } from '@testmaker/core/schema'
import type { WorksheetItemDraft, WorksheetTarget } from '@testmaker/core/ai'
import {
  Button,
  Input,
  Label,
  pocet,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
  useMatchesMedia,
} from '@testmaker/ui'
import type { Role } from '@/lib/role'
import type { PickerTopic } from '@/lib/questionPicker'
import { errorMessage, jsonBody, requestJson, SERVER_TROUBLE } from '@/lib/requestJson'
import { PrintMenu } from '@/components/PrintMenu'
import { QuestionEditor } from '@/components/QuestionEditor'
import { testPath } from '@/app/tests/paths'
import { emptyTable } from '@/components/test-builder/WorksheetItems'
import { TestVariantMenu } from '@/components/TestVariantMenu'
import { BankPanel } from '@/components/test-builder/BankPanel'
import { TestPage } from '@/components/test-builder/TestPage'
import { RandomDialog, type InsertMode } from '@/components/test-builder/RandomDialog'
import { TestSettings } from '@/components/test-builder/TestSettings'
import {
  nextDraftKey,
  type BankFilters,
  type DraftItem,
  type TestSettingsValue,
  type WorksheetAddKind,
} from '@/components/test-builder/types'
import { defaultTemplateId, emptyHeader } from '@/components/test-builder/defaults'

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
  gradeId,
  gradeLabel,
  backTopic,
  role,
  ai,
  dropped = 0,
  mine = true,
}: {
  topics: PickerTopic[]
  templates: Template[]
  test: Test | null
  items: ResolvedTestItem[]
  /** Třída testu (`gradeId` z `loadTest`) — jí se předfiltruje banka. */
  gradeId?: string | null
  /** Popisek třídy k zobrazení v hlavičce, např. „Přírodopis · 6. ročník". */
  gradeLabel?: string | null
  /** Téma, ze kterého test vznikl (`?tema=`) — jen když patří škole. */
  backTopic?: { id: string; name: string } | null
  /** Role přihlášené osoby — náhled verzi písemky nesmí vůbec vidět. */
  role?: Role
  /**
   * Je nastavené generování (`aiStatus()` ze stránky)? Bez modelu verze
   * písemky vzniknout nemůže — nabídka to řekne místo tlačítek, která by
   * skončila chybou.
   */
  ai: { configured: boolean; problems: string[] }
  /** Kolik položek model po vygenerování listu vynechal (`?vynechano=`). */
  dropped?: number
  /**
   * Je písemka přihlášené osoby? Nasdílenou od kolegyně server přepsat
   * nedovolí, takže se jen čte a tiskne a k úpravám se nabízí kopie.
   */
  mine?: boolean
}) {
  const router = useRouter()
  const readOnly = !mine
  const narrow = useMatchesMedia('(max-width: 1023.98px)')
  // Pracovní list vzniká vždy z formuláře „Nový pracovní list“, takže do
  // editoru přichází už uložený a druh se pozná podle testu.
  const worksheet = test?.kind === 'pracovni_list'
  const kind = test?.kind ?? 'pisemka'
  const [settings, setSettings] = useState<TestSettingsValue>(() => ({
    title: test?.title ?? '',
    description: test?.description ?? '',
    graded: test?.graded ?? true,
    templateId: test?.templateId ?? defaultTemplateId(templates),
    header: test?.header ?? emptyHeader(),
    variants: test?.variants ?? 1,
    // Klíč se už nenastavuje u testu, ale volí se až při tisku („Zadání pro
    // žáky" / „Klíč pro mě"). Sloupec v databázi zůstává, jen ho nic nemění.
    showKey: test?.showKey ?? true,
    // Písemka je ve výchozím stavu soukromá; nasdílí se, až když si to
    // autorka řekne.
    visibility: test?.visibility ?? 'soukrome',
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
      puzzleId: item.puzzleId ?? null,
      puzzle: item.puzzle ?? null,
      table: item.table ?? null,
      textContent: item.textContent ?? null,
      needsCheck: item.needsCheck ?? false,
    })),
  )
  // Na stav otázky se tu nefiltruje: do banky jdou ze serveru jen schválené
  // otázky, takže do ostré písemky nemá koncept kudy proklouznout.
  //
  // Výchozí filtr třídy = třída testu — kdo dělá písemku pro 6. B, chce
  // nejdřív vidět jen 6. B. Přepnutím na „Všechny třídy" jde vybrat i z
  // jiných ročníků, tak vzniká opakovací test napříč tématy. Test bez třídy
  // (starší nebo založený bez tématu) nabídne rovnou všechno jako dřív.
  const [filters, setFilters] = useState<BankFilters>({
    search: '',
    subject: '',
    // Předfiltrovat na třídu testu má smysl, jen když v bance vůbec něco z
    // téhle třídy je — jinak by na Select svítil prázdný štítek nad prázdnou
    // bankou a učitelka by nevěděla, že za to může zapnutý filtr.
    grade: gradeId && topics.some((topic) => topic.gradeId === gradeId) ? gradeId : '',
    type: '',
  })
  const [saving, setSaving] = useState(false)
  const [copying, setCopying] = useState(false)
  // Jen chyba názvu — patří k poli; ostatní chyby akcí jdou do oznámení (toast).
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
      puzzleId: null,
      puzzle: null,
      table: null,
      textContent: null,
      needsCheck: false,
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
        puzzleId: null,
        puzzle: null,
        table: null,
        textContent: null,
        needsCheck: false,
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

  /* --------------------------------------------------- pracovní list */

  // Editor úlohy listu: `key` upravované položky, nebo místo pro novou.
  const [questionDialog, setQuestionDialog] = useState<{ key: string | null; index?: number } | null>(null)
  const [regenerating, setRegenerating] = useState<string | null>(null)

  function insertAt(item: DraftItem, index?: number) {
    setDraft((current) => {
      const at = Math.min(Math.max(index ?? current.length, 0), current.length)
      const next = [...current]
      next.splice(at, 0, item)
      return next
    })
  }

  /** Úloha listu jako otázka pro náhled; metadata banky u ní nic neznamenají. */
  function worksheetQuestion(content: QuestionContent): Question {
    return {
      ...content,
      id: nextDraftKey(),
      topicId: null,
      materialId: null,
      source: 'manual',
      status: 'approved',
      createdAt: '',
      variantOf: null,
    } as Question
  }

  const blankItem = (kind: DraftItem['kind']): DraftItem => ({
    key: nextDraftKey(),
    id: null,
    kind,
    questionId: null,
    text: null,
    pointsOverride: null,
    linesOverride: null,
    question: null,
    puzzleId: null,
    puzzle: null,
    table: null,
    textContent: null,
    needsCheck: false,
  })

  function addWorksheetItem(kind: WorksheetAddKind, index?: number) {
    if (kind === 'question') return setQuestionDialog({ key: null, index })
    if (kind === 'table') return insertAt({ ...blankItem('table'), table: emptyTable() }, index)
    insertAt({ ...blankItem('text'), text: '', textContent: { variant: kind } }, index)
  }

  function submitQuestion(content: QuestionContent) {
    if (!questionDialog) return
    if (questionDialog.key) patchItem(questionDialog.key, { question: worksheetQuestion(content) })
    else insertAt({ ...blankItem('question'), question: worksheetQuestion(content) }, questionDialog.index)
    setQuestionDialog(null)
  }

  /** Položka od modelu v podobě položky editoru; klíč a id zůstávají původní. */
  function fromModel(item: WorksheetItemDraft, previous: DraftItem): DraftItem {
    const base = { ...blankItem(item.kind), key: previous.key, id: previous.id, needsCheck: item.needsCheck }
    switch (item.kind) {
      case 'heading':
      case 'instruction':
        return { ...base, text: item.text }
      case 'text':
        return { ...base, text: item.text, textContent: item.content }
      case 'table':
        return { ...base, table: item.content }
      case 'question':
        return { ...base, question: worksheetQuestion(item.question) }
    }
  }

  function targetOf(item: DraftItem): WorksheetTarget | null {
    if (item.kind === 'heading' || item.kind === 'instruction' || item.kind === 'table') return { kind: item.kind }
    if (item.kind === 'text') return { kind: item.textContent?.variant ?? 'text' }
    if (item.kind === 'question' && item.question) return { kind: 'question', questionType: item.question.type }
    return null
  }

  /** Text položky pro seznam „tohle už na listu je“. */
  function summaryOf(item: DraftItem): string {
    if (item.kind === 'question') return (item.question?.payload as { prompt?: string } | undefined)?.prompt ?? ''
    if (item.kind === 'table') return item.table ? `Tabulka: ${item.table.header.join(', ')}` : ''
    return item.text ?? ''
  }

  /**
   * Nová podoba jednoho kusu od modelu, na tomtéž místě. Neukládá se sama —
   * list se uloží tlačítkem Uložit jako po každé jiné úpravě.
   */
  async function regenerate(key: string) {
    const item = draft.find((candidate) => candidate.key === key)
    const target = item ? targetOf(item) : null
    if (!item || !target || !savedId) return
    setRegenerating(key)
    const failure = 'Položku se nepodařilo přegenerovat.'
    try {
      const data = await requestJson<{ item: WorksheetItemDraft }>(
        `/api/worksheets/${encodeURIComponent(savedId)}/items/${encodeURIComponent(item.id ?? key)}/regenerate`,
        jsonBody('POST', {
          target,
          existing: draft.filter((other) => other.key !== key).map(summaryOf).filter(Boolean),
        }),
        failure,
      )
      if (!data.item) throw new Error(`${failure} ${SERVER_TROUBLE}`)
      const replacement = fromModel(data.item, item)
      setDraft((current) => current.map((candidate) => (candidate.key === key ? replacement : candidate)))
      // Nová podoba přepíše i ruční úpravy položky — původní jde ještě vrátit.
      toast.success('Položka je přegenerovaná.', {
        duration: 10_000,
        action: {
          label: 'Vrátit',
          onClick: () => setDraft((current) => current.map((candidate) => (candidate.key === key ? item : candidate))),
        },
      })
    } catch (regenerateError) {
      toast.error(errorMessage(regenerateError, failure))
    } finally {
      setRegenerating(null)
    }
  }

  const toCheck = draft.filter((item) => item.needsCheck).length

  /** Otisk toho, co je opravdu uložené — porovnáním se pozná neuložená změna. */
  const fingerprint = useMemo(
    () =>
      JSON.stringify({
        settings,
        items: draft.map((item) => ({
          kind: item.kind,
          questionId: item.questionId,
          puzzleId: item.puzzleId,
          text: item.text,
          pointsOverride: item.pointsOverride,
          linesOverride: item.linesOverride,
          table: item.table,
          textContent: item.textContent,
          needsCheck: item.needsCheck,
          // Úloha listu žije jen v položce — její úprava je změna listu.
          question: worksheet && !item.questionId ? item.question : null,
        })),
      }),
    [settings, draft, worksheet],
  )
  // Otisk naposledy uloženého stavu. Ve stavu, ne v ref — ref se během
  // vykreslování nemá číst a React na to upozorňuje.
  const [savedFingerprint, setSavedFingerprint] = useState<string | null>(test ? fingerprint : null)
  // Nasdílenou písemku uložit nejde, takže v ní ani není co ztratit.
  const dirty = !readOnly && savedFingerprint !== fingerprint

  // Zavření okna s rozpracovanou osnovou znamenalo ztrátu celé práce bez varování.
  // Odkazy uvnitř aplikace (zpět do tématu, hlavní nabídka) okno nezavírají,
  // `beforeunload` je nezachytí — proto se klik na ně ověří zvlášť.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    const leave = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
      const link = event.target instanceof Element ? event.target.closest('a[href^="/"]') : null
      if (!link || link.getAttribute('target') === '_blank') return
      if (window.confirm('Máš neuložené změny. Opravdu odejít?')) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('beforeunload', warn)
    document.addEventListener('click', leave, true)
    return () => {
      window.removeEventListener('beforeunload', warn)
      document.removeEventListener('click', leave, true)
    }
  }, [dirty])

  /** Kopie nasdílené písemky — tu si pak autorka upravuje po svém. */
  async function copy() {
    if (!savedId) return
    setCopying(true)
    const failure = 'Kopii se nepodařilo vytvořit.'
    try {
      const data = await requestJson<{ id: string }>(
        `/api/tests?copyOf=${encodeURIComponent(savedId)}`,
        { method: 'POST' },
        failure,
      )
      if (!data.id) throw new Error(`${failure} ${SERVER_TROUBLE}`)
      toast.success('Kopie je hotová — teď ji můžeš upravit.')
      router.push(testPath(kind, data.id))
    } catch (copyError) {
      toast.error(errorMessage(copyError, failure))
      setCopying(false)
    }
  }

  async function save() {
    setError(null)
    setTitleInvalid(false)
    if (!settings.title.trim()) {
      setTitleInvalid(true)
      titleRef.current?.focus()
      return setError(worksheet ? 'Vyplň název listu.' : 'Vyplň název písemky.')
    }
    if (worksheet) {
      if (draft.length === 0) return void toast.error('Přidej do listu aspoň jednu položku.')
    } else if (questionCount === 0) return void toast.error('Přidej aspoň jednu otázku.')

    setSaving(true)
    const body = {
      ...(savedId ? { id: savedId } : {}),
      title: settings.title.trim(),
      description: settings.description.trim() || null,
      graded: settings.graded,
      templateId: settings.templateId,
      // Třída testu se nemění v editoru — jen se drží, aby ji první uložení
      // (POST i PUT) nevynulovalo tím, že pole vůbec nepošle.
      gradeId: gradeId ?? null,
      header: settings.header,
      variants: settings.variants,
      showKey: settings.showKey,
      visibility: settings.visibility,
      items: draft.map((item) => ({
        id: item.id,
        kind: item.kind,
        questionId: item.questionId,
        // Hlavolam se do písemky zařazuje z obrazovky Hlavolamy; tady se jen
        // veze dál, aby ho přeuložení osnovy nesmazalo.
        puzzleId: item.puzzleId,
        text: item.text,
        pointsOverride: item.pointsOverride,
        linesOverride: item.linesOverride,
        content: item.kind === 'table' ? item.table : item.kind === 'text' ? item.textContent : undefined,
        needsCheck: item.needsCheck,
        // Úloha listu v bance není — její obsah jde se snímkem položky.
        question: worksheet && item.kind === 'question' && !item.questionId ? item.question : null,
      })),
    }

    const failure = worksheet ? 'List se nepodařilo uložit.' : 'Písemku se nepodařilo uložit.'
    try {
      const result = await requestJson<{ id: string; itemIds: string[] }>(
        '/api/tests',
        jsonBody(savedId ? 'PUT' : 'POST', body),
        failure,
      )
      const id = result.id
      if (!id) throw new Error(`${failure} ${SERVER_TROUBLE}`)
      // Bez id z uložení by další uložení položky nepoznalo a jejich zmrazené
      // snímky by se pořídily znovu z aktuální banky.
      const itemIds = result.itemIds
      if (itemIds) setDraft((current) => current.map((item, index) => ({ ...item, id: itemIds[index] ?? item.id })))
      setSavedFingerprint(fingerprint)
      setSavedId(id)
      toast.success('Uloženo.')
      // `?vynechano=` patří jen k čerstvě vygenerovanému listu — po uložení
      // by upozornění na vynechané položky viselo dál, proto adresa bez něj.
      if (!test || dropped > 0) router.replace(testPath(kind, id))
      else router.refresh()
    } catch (saveError) {
      toast.error(errorMessage(saveError, failure))
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
      worksheet={
        worksheet
          ? {
              onAdd: addWorksheetItem,
              onEditQuestion: (key) => setQuestionDialog({ key }),
              // Přegenerovat jde jen s nastaveným modelem a u uloženého listu
              // (zadání listu je na serveru); náhled nemění nic.
              onRegenerate: ai.configured && savedId && role !== 'nahled' ? (key) => void regenerate(key) : undefined,
              regenerating,
            }
          : undefined
      }
    />
  )
  const editedQuestion = questionDialog?.key
    ? (draft.find((item) => item.key === questionDialog.key)?.question ?? null)
    : null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* Název není nastavení mezi ostatními: bez něj se test neuloží, takže
            patří do hlavičky na oči, ne do panelu, který se ani neotevře. */}
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="ui-page-title">
            {worksheet ? 'Úprava pracovního listu' : test ? 'Úprava testu' : 'Nový test'}
          </h1>
          {gradeLabel || backTopic ? (
            <p className="mt-1 text-sm text-fg-muted">
              {gradeLabel}
              {gradeLabel && backTopic ? ' · ' : null}
              {backTopic ? (
                <Link href={`/topics/${backTopic.id}`} className="underline hover:no-underline">
                  ← Zpět do tématu {backTopic.name}
                </Link>
              ) : null}
            </p>
          ) : null}
          <div className="mt-2 max-w-md">
            <Label htmlFor="test-title">{worksheet ? 'Název listu' : 'Název písemky'}</Label>
            <Input
              id="test-title"
              ref={titleRef}
              value={settings.title}
              maxLength={200}
              readOnly={readOnly}
              placeholder={worksheet ? 'Např. Sopky – procvičování' : 'Např. Čtvrtletní písemka – přírodopis'}
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
          {savedId ? <PrintMenu testId={savedId} variants={settings.variants} dirty={dirty} /> : null}
          {readOnly ? (
            <Button disabled={copying} aria-busy={copying || undefined} onClick={() => void copy()}>
              {copying ? 'Kopíruji…' : 'Vytvořit kopii'}
            </Button>
          ) : null}
          {/* Verze písemky vzniká z uložené podoby — bez uloženého testu (nový
              test, role náhled) nemá tlačítko co dělat. */}
          {savedId && role !== 'nahled' && !worksheet && !readOnly ? (
            <TestVariantMenu
              testId={savedId}
              ai={ai}
              dirty={dirty}
              onDirty={() => toast.error('Nejdřív ulož písemku — verze vzniká z uložené podoby, ne z rozpracované úpravy.')}
            />
          ) : null}
          {/* Losování i banka patří písemce — úlohy listu z banky nejsou. */}
          {readOnly ? null : (
            <>
              {worksheet ? null : <RandomDialog topics={topics} hasDraft={draft.length > 0} onInsert={insertRandom} />}
              <TestSettings value={settings} templates={templates} onChange={setSettings} worksheet={worksheet} />
              {dirty ? (
                <span className="text-sm text-fg-muted" role="status">
                  Neuložené změny
                </span>
              ) : null}
              <Button disabled={saving} onClick={() => void save()}>{saving ? 'Ukládám…' : 'Uložit'}</Button>
            </>
          )}
        </div>
      </div>

      {readOnly ? (
        <p className="rounded-[var(--radius-inner)] bg-surface-muted px-3 py-2 text-sm text-fg-soft">
          Sdílená písemka — pro úpravy si vytvoř kopii.
        </p>
      ) : null}

      {error ? (
        <p id="test-title-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {worksheet && dropped > 0 ? (
        <p className="text-sm text-fg-muted">
          {pocet(dropped, ['položku', 'položky', 'položek'])} model nevrátil v pořádku a{' '}
          {dropped === 1 ? 'vynechala se' : 'vynechaly se'}. Chybějící kus můžeš přidat ručně.
        </p>
      ) : null}
      {worksheet && toCheck > 0 ? (
        // Nenápadné upozornění; tisk nijak neblokuje.
        <p className="rounded-[var(--radius-inner)] bg-draft-bg px-3 py-2 text-sm text-draft-fg" data-slot="ke-kontrole">
          Ke kontrole: {pocet(toCheck, ['položka', 'položky', 'položek'])}. Jejich obsah nevychází z materiálů —
          ověř ho a značku „ověř“ pak odškrtni kliknutím.
        </p>
      ) : null}

      {questionDialog ? (
        <QuestionEditor
          topicId=""
          question={editedQuestion}
          title={editedQuestion ? 'Upravit úlohu' : 'Nová úloha'}
          onClose={() => setQuestionDialog(null)}
          onSaved={() => setQuestionDialog(null)}
          onSubmit={submitQuestion}
        />
      ) : null}

      {/* Vykresluje se jen jedna podoba. Obě naráz (jedna schovaná) znamenaly
          zdvojená `id` filtrů a zdvojené zaškrtávátko „Vybrat vše". */}
      {readOnly ? (
        // Nasdílená písemka se jen prohlíží: banka by nebyla k ničemu a
        // `fieldset disabled` vypne všechno ovládání stránky naráz.
        <fieldset disabled className="contents">
          <div className="h-[75vh]">{sheet}</div>
        </fieldset>
      ) : worksheet ? (
        // List banku nemá — stránka dostane celou šířku.
        <div className="h-[75vh]">{sheet}</div>
      ) : narrow ? (
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
