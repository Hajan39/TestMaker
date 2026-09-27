'use client'

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Question, QuestionStatus, QuestionType } from '@testmaker/core/schema'
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

/** Jedna verze kořenové otázky, jak ji vrací `loadVariantLinks`. */
export interface VariantLink {
  id: string
  difficulty: 1 | 2 | 3
  status: QuestionStatus
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
    /**
     * Lehčí a těžší verze podle kořene (`loadVariantLinks`), pro řádek
     * „Verze: …" na kartě. Klíč je id kořenové otázky, ne otázky samotné.
     */
    variantLinks: Record<string, VariantLink[]>
  }
>(function TopicQuestions({ topic, defaultTemplateId, questions, usage, rejectedCount, variantLinks }, ref) {
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
  // Lehčí nebo těžší verze vzniklá v téhle relaci — objeví se hned, bez
  // čekání na `router.refresh()` (ten navíc nemusí nic nového ukázat, když
  // se odpověď serveru v e2e testu jen podvrhuje). Otázky, které se mezitím
  // objevily i v `questions` (po skutečném obnovení stránky), se odtud
  // vyřadí, ať se karta nezdvojí.
  const [freshVersions, setFreshVersions] = useState<Question[]>([])
  // Karta, na kterou právě odkázal řádek „Verze: …" nebo která právě vznikla
  // jako nová verze — krátce zvýrazněná, ať je vidět, že se posun povedl.
  // Vedle id nese i pořadí skoku: druhý skok na tutéž kartu (třeba hned po
  // vzniku verze, dokud ještě svítí) musí odpočet spustit znovu, jinak by
  // zvýraznění zhaslo dřív, než se k ní pohled posune.
  const [highlight, setHighlight] = useState<{ id: string; jump: number } | null>(null)
  const highlightedId = highlight?.id ?? null
  // Id karty, ke které se má po překreslení posunout pohled — dvoukrokové
  // (nastavit stav, pak v efektu najít prvek v DOM), protože hned po
  // `setFreshVersions` nová karta v DOM ještě není.
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null)
  // Posun a rozsvícení jsou dva samostatné efekty schválně: kdyby byl posun
  // (nastavení `pendingScrollId`) a odpočet zvýraznění ve stejném efektu,
  // úklid po tomhle efektu (spuštěný, jakmile `pendingScrollId` doběhne zpět
  // na `null`) by smazal i právě nastavený časovač zvýraznění — karta by
  // zůstala rozsvícená napořád, protože by se zvýraznění nikdy
  // nezavolalo.
  useEffect(() => {
    if (!pendingScrollId) return
    const el = document.querySelector(`[data-question-id="${pendingScrollId}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlight((current) => ({ id: pendingScrollId, jump: (current?.jump ?? 0) + 1 }))
    setPendingScrollId(null)
  }, [pendingScrollId])
  useEffect(() => {
    if (!highlight) return
    const timeout = window.setTimeout(
      () => setHighlight((current) => (current === highlight ? null : current)),
      1500,
    )
    return () => window.clearTimeout(timeout)
  }, [highlight])
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
  // Kurzor za poslední načtenou smazanou otázkou — `null` znamená „další
  // stránka není" (buď se ještě nenačetlo nic, nebo je to konec seznamu;
  // rozlišuje to `deletedQuestions === null`).
  const [deletedCursor, setDeletedCursor] = useState<string | null>(null)
  const [loadingMoreDeleted, setLoadingMoreDeleted] = useState(false)
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

  // Verze vzniklé v téhle relaci se přidávají k otázkám ze serveru — po
  // skutečném obnovení stránky se objeví i tam a odtud se pak vyřadí podle
  // id, ať se karta nezdvojí.
  const allQuestions = useMemo(() => {
    const known = new Set(questions.map((question) => question.id))
    return [...freshVersions.filter((question) => !known.has(question.id)), ...questions]
  }, [questions, freshVersions])

  const sorted = useMemo(
    () =>
      allQuestions
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    [allQuestions],
  )

  // Smazané (nebo přegenerované) karty se z tématu odečítají úplně — na
  // hlavičce i na nabídce typů v filtru; filtr sám počet dál nemění.
  const active = useMemo(() => sorted.filter((question) => !hiddenIds.has(question.id)), [sorted, hiddenIds])

  // Kořen podle id — kartě verze dovolí najít vlastní kořen (`variantOf`) i
  // s jeho obtížností, ať řádek „Verze: …" pozná, co je oproti ní lehčí nebo
  // těžší. `allQuestions`, ne `active`: kořen zůstává ve hře, i kdyby jeho
  // vlastní kartu zrovna schovalo optimistické smazání nebo přegenerování.
  const byId = useMemo(() => new Map(allQuestions.map((question) => [question.id, question])), [allQuestions])

  // `variantLinks` ze serveru (`loadVariantLinks`) doplněné o verze vzniklé
  // v téhle relaci — ty v odpovědi serveru ještě být nemusí (u e2e testů
  // vůbec, tam se odpověď na vytvoření verze jen podvrhuje).
  const mergedVariantLinks = useMemo(() => {
    const merged: Record<string, VariantLink[]> = {}
    for (const [rootId, links] of Object.entries(variantLinks)) merged[rootId] = [...links]
    for (const question of freshVersions) {
      if (!question.variantOf) continue
      const list = merged[question.variantOf] ?? (merged[question.variantOf] = [])
      if (!list.some((link) => link.id === question.id)) {
        list.push({ id: question.id, difficulty: question.difficulty, status: question.status })
      }
    }
    return merged
  }, [variantLinks, freshVersions])

  /**
   * Verze kořene otázky (nebo otázky samotné, je-li kořen), pro řádek
   * „Verze: …" na kartě. Zamítnuté (smazané) verze se nenabízejí — jejich
   * karta v seznamu není, odkaz by nikam nevedl. Stejně tak se vynechá
   * cokoli mimo `byId` (otázka, která v tomhle tématu vůbec není — cizí
   * téma, nebo se ještě nenačetla) a cokoli v `hiddenIds` (smazaná nebo
   * přegenerovaná karta zrovna teď mizí ze seznamu, ale server o tom
   * ještě neví) — odkaz by v obou případech nikam nevedl.
   */
  function versionsFor(question: Question): { id: string; label: 'lehčí' | 'těžší' }[] {
    const rootId = question.variantOf ?? question.id
    const entries: { id: string; difficulty: 1 | 2 | 3 }[] = []
    if (rootId !== question.id && !hiddenIds.has(rootId)) {
      const root = byId.get(rootId)
      if (root) entries.push({ id: root.id, difficulty: root.difficulty })
    }
    for (const link of mergedVariantLinks[rootId] ?? []) {
      if (link.id === question.id || link.status === 'rejected' || hiddenIds.has(link.id)) continue
      const sibling = byId.get(link.id)
      if (!sibling) continue
      entries.push({ id: link.id, difficulty: sibling.difficulty })
    }
    return entries
      .filter((entry) => entry.difficulty !== question.difficulty)
      .map((entry) => ({ id: entry.id, label: entry.difficulty < question.difficulty ? 'lehčí' : 'těžší' }))
  }

  /**
   * Posune pohled na kartu a krátce ji zvýrazní — z řádku „Verze: …" i po
   * vytvoření nové verze. Když cíl zrovna schovává filtr (typ, obtížnost,
   * „jen nepoužité"), filtr se nejdřív zruší — jinak by se posun neměl kam
   * posunout, karta by v DOM vůbec nebyla.
   */
  function jumpToQuestion(id: string) {
    const jeSchovanyFiltrem = !visible.some((question) => question.id === id) && active.some((question) => question.id === id)
    if (jeSchovanyFiltrem) resetFilters()
    setPendingScrollId(id)
  }

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

  /**
   * Dotáhne smazané (zamítnuté) otázky tématu — jen jednou, při prvním
   * zapnutí. Řadí se od nejnovějších (`order=desc`), ať je nahoře to, co
   * učitelka smazala naposled; stránka se bere jen jedna, další přes
   * „Načíst další" (`loadMoreDeleted`).
   */
  async function loadDeleted() {
    setLoadingDeleted(true)
    try {
      const response = await fetch(
        `/api/questions?topicId=${encodeURIComponent(topic.id)}&status=rejected&order=desc`,
      )
      if (!response.ok) throw new Error('Smazané otázky se nepodařilo načíst.')
      const data = (await response.json()) as { items: Question[]; nextCursor: string | null }
      setDeletedQuestions(data.items)
      setDeletedCursor(data.nextCursor)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Smazané otázky se nepodařilo načíst.')
      setShowDeleted(false)
    } finally {
      setLoadingDeleted(false)
    }
  }

  /** Dotáhne další stránku smazaných otázek za kurzorem z předchozího načtení. */
  async function loadMoreDeleted() {
    if (!deletedCursor) return
    setLoadingMoreDeleted(true)
    try {
      const response = await fetch(
        `/api/questions?topicId=${encodeURIComponent(topic.id)}&status=rejected&order=desc&cursor=${encodeURIComponent(deletedCursor)}`,
      )
      if (!response.ok) throw new Error('Další smazané otázky se nepodařilo načíst.')
      const data = (await response.json()) as { items: Question[]; nextCursor: string | null }
      setDeletedQuestions((current) => [...(current ?? []), ...data.items])
      setDeletedCursor(data.nextCursor)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Další smazané otázky se nepodařilo načíst.')
    } finally {
      setLoadingMoreDeleted(false)
    }
  }

  // Panel smazaných je dole pod dlouhým seznamem otázek — bez posunu na
  // pohled by po zapnutí přepínače nebylo v dlouhém tématu vůbec vidět, že se
  // něco stalo.
  const deletedPanelRef = useRef<HTMLDivElement>(null)

  function toggleShowDeleted() {
    setShowDeleted((current) => {
      const next = !current
      if (next && deletedQuestions === null) void loadDeleted()
      if (next) {
        requestAnimationFrame(() => deletedPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      }
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
            <li
              key={question.id}
              data-question-id={question.id}
              className={
                highlightedId === question.id
                  ? 'rounded-[var(--radius-inner)] bg-brand-bg py-3 transition-colors'
                  : 'py-3 transition-colors'
              }
            >
              <QuestionCard
                topicId={topic.id}
                question={question}
                editing={editingId === question.id}
                muzeMenit={muzeMenit}
                selected={selectedIds.has(question.id)}
                busy={busyIds.has(question.id)}
                usage={usage[question.id]}
                versions={versionsFor(question)}
                onEditStart={() => setEditingId(question.id)}
                onEditCancel={() => setEditingId(null)}
                onEditSaved={() => {
                  setEditingId(null)
                  router.refresh()
                }}
                onToggleSelect={() => toggleSelection(question.id)}
                onRegenerateDone={() => setHiddenIds((current) => new Set(current).add(question.id))}
                onVariantCreated={(created) => {
                  setFreshVersions((current) => [created, ...current])
                  jumpToQuestion(created.id)
                }}
                onJumpToVersion={jumpToQuestion}
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
        <div ref={deletedPanelRef} className="mt-4 border-t border-line-soft pt-3">
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
                    versions={[]}
                    onEditStart={() => {}}
                    onEditCancel={() => {}}
                    onEditSaved={() => {}}
                    onToggleSelect={() => {}}
                    onRegenerateDone={() => {}}
                    onVariantCreated={() => {}}
                    onJumpToVersion={() => {}}
                    onRemove={() => {}}
                    deleted
                    restoring={restoringIds.has(question.id)}
                    onRestore={() => void restore(question)}
                  />
                </li>
              ))}
            </ul>
          )}
          {deletedCursor ? (
            <div className="mt-3 flex justify-center">
              <Button
                size="sm"
                variant="outline"
                disabled={loadingMoreDeleted}
                onClick={() => void loadMoreDeleted()}
              >
                {loadingMoreDeleted ? 'Načítám…' : 'Načíst další'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
})
