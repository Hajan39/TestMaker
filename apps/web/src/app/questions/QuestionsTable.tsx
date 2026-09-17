'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
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
  DeleteButton,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  planUndo,
  toast,
  useMatchesMedia,
  pocet,
  OTAZKY,
} from '@testmaker/ui'
import { QuestionEditor } from '@/components/QuestionEditor'
import { QuestionActions } from './QuestionActions'

const STATUS_LABELS: Record<QuestionStatus, string> = {
  draft: 'Koncept',
  approved: 'Schváleno',
  rejected: 'Zamítnuto',
}

/** Kolik identifikátorů nejvíc pojme jeden požadavek na hromadnou změnu stavu. */
const BULK_CHUNK = 200

/** Jak dlouho se čeká, než se psaní v hledání promítne do adresy. */
const SEARCH_DELAY = 350

export interface BankFilters {
  subjectId: string
  gradeId: string
  topicId: string
  type: QuestionType | ''
  status: QuestionStatus | ''
  search: string
}

interface TopicOption {
  id: string
  name: string
  gradeId: string
  subjectId: string
  label: string
}

/** Skloňování počtu otázek: 1 otázka, 2–4 otázky, 5 a víc otázek. */
/** Zadání otázky do řádku tabulky. */
function promptOf(question: Question): string {
  const payload = question.payload as { prompt?: string; text?: string }
  return payload.prompt || payload.text?.slice(0, 160) || '(bez zadání)'
}

/** Filtry do adresy — prázdné se vynechávají, ať je odkaz čitelný. */
function toQuery(filters: BankFilters): string {
  const params = new URLSearchParams()
  if (filters.subjectId) params.set('subjectId', filters.subjectId)
  if (filters.gradeId) params.set('gradeId', filters.gradeId)
  if (filters.topicId) params.set('topicId', filters.topicId)
  if (filters.type) params.set('type', filters.type)
  if (filters.status) params.set('status', filters.status)
  if (filters.search.trim()) params.set('q', filters.search.trim())
  return params.toString()
}

/** Tytéž filtry pro dotaz na další stránku (API má vlastní jména parametrů). */
function toApiQuery(filters: BankFilters, cursor: string, limit: number): string {
  const params = new URLSearchParams()
  if (filters.subjectId) params.set('subjectId', filters.subjectId)
  if (filters.gradeId) params.set('gradeId', filters.gradeId)
  if (filters.topicId) params.set('topicId', filters.topicId)
  if (filters.type) params.set('type', filters.type)
  if (filters.status) params.set('status', filters.status)
  if (filters.search.trim()) params.set('q', filters.search.trim())
  params.set('limit', String(limit))
  params.set('cursor', cursor)
  return params.toString()
}

/** Zápis stavu po skupinách — jeden požadavek nemá nést stovky identifikátorů. */
async function writeStatus(ids: string[], status: QuestionStatus): Promise<void> {
  for (let start = 0; start < ids.length; start += BULK_CHUNK) {
    const response = await fetch('/api/questions', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ids.slice(start, start + BULK_CHUNK), status }),
    })
    if (!response.ok) throw new Error('Stav otázky se nepodařilo uložit')
  }
}

/**
 * Banka otázek: filtry napříč knihovnou, hromadné akce a úprava otázky rovnou
 * z řádku.
 *
 * Filtry i hledání se vyřizují na serveru a jsou v adrese — otázek je přes
 * tisíc a posílat je do prohlížeče všechny jen proto, aby se v nich dalo
 * hledat, znamenalo čekat při každém otevření stránky. Další stránka se
 * dotahuje až na vyžádání tlačítkem.
 */
export function QuestionsTable({
  subjects,
  grades,
  topics,
  filters,
  items,
  nextCursor,
  total,
  pageSize,
}: {
  subjects: { id: string; name: string }[]
  grades: { id: string; name: string; subjectId: string }[]
  topics: TopicOption[]
  filters: BankFilters
  items: Question[]
  nextCursor: string | null
  total: number
  pageSize: number
}) {
  const router = useRouter()
  // Pod 640 px se místo tabulky vykreslují karty: sloupce se stavem i celá
  // nabídka akcí by na telefonu zůstaly za okrajem obrazovky a s otázkou by
  // nešlo udělat nic. Vykresluje se vždy jen jedna podoba — obě naráz znamenají
  // zdvojená zaškrtávátka i popisky.
  const phone = useMatchesMedia('(max-width: 639.98px)')
  const [rows, setRows] = useState(items)
  const [cursor, setCursor] = useState(nextCursor)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadingMore, setLoadingMore] = useState(false)
  const [pending, setPending] = useState<'approved' | 'rejected' | null>(null)
  const [refreshing, startRefresh] = useTransition()
  const [navigating, startNavigate] = useTransition()
  const [editing, setEditing] = useState<Question | null>(null)
  const [search, setSearch] = useState(filters.search)
  // Poslední stránka a filtry, které přišly ze serveru — podle nich se pozná,
  // že se obsah pod rukama vyměnil.
  const [fromServer, setFromServer] = useState({ items, search: filters.search })

  /**
   * Stránka ze serveru je vždy ta první. Přijde po změně filtru i po obnovení
   * seznamu (hromadná akce, úprava otázky) — dotažené další stránky se tím
   * zahodí schválně: po schválení nebo smazání už neplatí. Srovnání se dělá
   * při vykreslení, ne v efektu: kdyby se čekalo na efekt, blikla by mezitím
   * stará stránka.
   */
  if (fromServer.items !== items || fromServer.search !== filters.search) {
    setFromServer({ items, search: filters.search })
    setRows(items)
    setCursor(nextCursor)
    setSelected(new Set())
    // Návrat tlačítkem zpět (nebo poslaný odkaz) mění i hledaný text; políčko
    // se s ním musí srovnat, jinak by ukazovalo, co už neplatí.
    if (fromServer.search !== filters.search) setSearch(filters.search)
  }

  /** Nové filtry do adresy; obsah stránky doplní server. */
  const apply = useCallback(
    (next: BankFilters) => {
      const query = toQuery(next)
      startNavigate(() => router.push(query ? `/questions?${query}` : '/questions', { scroll: false }))
    },
    [router],
  )

  // Hledání se do adresy propisuje se zpožděním, aby se stránka nenačítala po
  // každém písmenu. Při psaní se `filters` nemění (server se mezitím neptá),
  // takže odpočet nikdo nerestartuje.
  useEffect(() => {
    if (search === filters.search) return
    const timer = setTimeout(() => apply({ ...filters, search }), SEARCH_DELAY)
    return () => clearTimeout(timer)
  }, [search, filters, apply])

  const visibleGrades = useMemo(
    () => grades.filter((grade) => !filters.subjectId || grade.subjectId === filters.subjectId),
    [grades, filters.subjectId],
  )
  const visibleTopics = useMemo(
    () =>
      topics.filter(
        (topic) =>
          (!filters.subjectId || topic.subjectId === filters.subjectId) &&
          (!filters.gradeId || topic.gradeId === filters.gradeId),
      ),
    [topics, filters.subjectId, filters.gradeId],
  )
  const topicById = useMemo(() => new Map(topics.map((topic) => [topic.id, topic])), [topics])

  const filtered =
    Boolean(filters.subjectId) ||
    Boolean(filters.gradeId) ||
    Boolean(filters.topicId) ||
    Boolean(filters.type) ||
    Boolean(filters.status) ||
    Boolean(filters.search.trim())

  async function loadMore() {
    if (!cursor) return
    setLoadingMore(true)
    try {
      const response = await fetch(`/api/questions?${toApiQuery(filters, cursor, pageSize)}`)
      if (!response.ok) throw new Error('Další otázky se nepodařilo načíst')
      const data = (await response.json()) as { items: Question[]; nextCursor: string | null }
      // Kurzor nikdy nevrátí otázku, která už je v seznamu, ale pojistka nic
      // nestojí: kdyby se přece jen zopakovala, React by hlásil dvojí klíč.
      setRows((current) => {
        const known = new Set(current.map((row) => row.id))
        return [...current, ...data.items.filter((item) => !known.has(item.id))]
      })
      setCursor(data.nextCursor)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Další otázky se nepodařilo načíst')
    } finally {
      setLoadingMore(false)
    }
  }

  /** Vrácení hromadné akce; otázky mohly mít předtím různé stavy. */
  async function undoBulk(previous: [string, QuestionStatus][]) {
    try {
      for (const step of planUndo(previous)) await writeStatus(step.ids, step.status)
      toast.success(`Vráceno zpět: ${pocet(previous.length, OTAZKY)}`)
      startRefresh(() => router.refresh())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Vrácení se nepodařilo')
    }
  }

  async function bulkStatus(next: 'approved' | 'rejected') {
    const ids = [...selected]
    if (ids.length === 0) return

    // Stavy před akcí se poznamenají dřív, než se seznam obnoví — jinak by se
    // „Vzít zpět“ nemělo k čemu vrátit.
    const previous = ids.flatMap((id): [string, QuestionStatus][] => {
      const question = rows.find((row) => row.id === id)
      return question ? [[id, question.status]] : []
    })

    setPending(next)
    try {
      await writeStatus(ids, next)
      setSelected(new Set())
      startRefresh(() => router.refresh())
      toast.success(
        `${next === 'approved' ? 'Schváleno' : 'Zamítnuto'}: ${pocet(ids.length, OTAZKY)}`,
        {
          duration: 10_000,
          action: { label: 'Vzít zpět', onClick: () => void undoBulk(previous) },
        },
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Změnu se nepodařilo uložit')
    } finally {
      setPending(null)
    }
  }

  async function removeSelected() {
    const ids = [...selected]
    if (ids.length === 0) return
    const query = ids.map((id) => `id=${encodeURIComponent(id)}`).join('&')
    const response = await fetch(`/api/questions?${query}`, { method: 'DELETE' })
    if (!response.ok) {
      toast.error('Otázky se nepodařilo smazat')
      return
    }
    setSelected(new Set())
    startRefresh(() => router.refresh())
    toast.success(`Smazáno: ${pocet(ids.length, OTAZKY)}`)
  }

  const busy = pending !== null || refreshing

  /**
   * Hromadný výběr se vztahuje na to, co je právě načtené. Filtr tak slouží
   * zároveň jako výběr: učitelka si nastaví „zamítnuté v osmičce“ a zaškrtne
   * je jedním kliknutím.
   */
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id))
  const someSelected = rows.some((row) => selected.has(row.id))

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current)
      for (const row of rows) {
        if (allSelected) next.delete(row.id)
        else next.add(row.id)
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
        <h2 className="text-sm font-semibold text-fg" aria-live="polite">
          {rows.length} z {pocet(total, OTAZKY)}
        </h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <Label htmlFor="q-subject">Předmět</Label>
            <Select
              value={filters.subjectId || 'vse'}
              onValueChange={(value) =>
                // Se změnou předmětu padá zúžení na ročník i téma — jinak by
                // filtr ukazoval prázdno kvůli tématu z jiného předmětu.
                apply({
                  ...filters,
                  subjectId: value === 'vse' ? '' : value,
                  gradeId: '',
                  topicId: '',
                  search,
                })
              }
            >
              <SelectTrigger id="q-subject" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vse">Všechny</SelectItem>
                {subjects.map((subject) => (
                  <SelectItem key={subject.id} value={subject.id}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Label htmlFor="q-grade">Ročník</Label>
            <Select
              value={filters.gradeId || 'vse'}
              onValueChange={(value) =>
                apply({ ...filters, gradeId: value === 'vse' ? '' : value, topicId: '', search })
              }
            >
              <SelectTrigger id="q-grade" className="w-full">
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
          <div className="w-52">
            <Label htmlFor="q-topic">Téma</Label>
            <Select
              value={filters.topicId || 'vse'}
              onValueChange={(value) =>
                apply({ ...filters, topicId: value === 'vse' ? '' : value, search })
              }
            >
              <SelectTrigger id="q-topic" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vse">Všechna</SelectItem>
                {visibleTopics.map((topic) => (
                  <SelectItem key={topic.id} value={topic.id}>
                    {topic.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <Label htmlFor="q-type">Typ</Label>
            <Select
              value={filters.type || 'vse'}
              onValueChange={(value) =>
                apply({ ...filters, type: value === 'vse' ? '' : (value as QuestionType), search })
              }
            >
              <SelectTrigger id="q-type" className="w-full">
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
            <Label htmlFor="q-status">Stav</Label>
            <Select
              value={filters.status || 'vse'}
              onValueChange={(value) =>
                apply({ ...filters, status: value === 'vse' ? '' : (value as QuestionStatus), search })
              }
            >
              <SelectTrigger id="q-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vse">Všechny</SelectItem>
                {Object.entries(STATUS_LABELS).map(([status, label]) => (
                  <SelectItem key={status} value={status}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Label htmlFor="q-search">Hledat</Label>
            <Input
              id="q-search"
              value={search}
              placeholder="text otázky"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </div>
      </div>

      {selected.size > 0 ? (
        // Počet je v liště jednou, vlevo; tlačítka ho neopakují a mají tutéž
        // váhu — dřív stály vedle sebe čtyři různé vzhledy a číslo dvakrát.
        // Nižší váhu má jen „Zrušit výběr“, protože z lišty vede pryč.
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded bg-surface-muted px-3 py-2">
          <span className="text-sm text-fg-soft">Vybráno {selected.size}</span>
          <BusyButton
            size="sm"
            variant="outline"
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
            label="Smazat"
            variant="outline"
            title="Smazat vybrané otázky?"
            description={`Smaže se ${pocet(selected.size, OTAZKY)}. Pokud jsou použité v uloženém testu, zůstane tam jejich zmrazené znění, ale z banky zmizí. Akci nejde vrátit zpět.`}
            onConfirm={removeSelected}
          />
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSelected(new Set())}>
            Zrušit výběr
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title={filtered ? 'Filtru nic neodpovídá' : 'Banka otázek je prázdná'}
            hint={
              filtered
                ? 'Zkus hledat jiné slovo nebo filtry rozvolnit.'
                : 'Otevři téma a vygeneruj otázky z materiálu, nebo si napiš vlastní.'
            }
            action={
              filtered ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('')
                    apply({ subjectId: '', gradeId: '', topicId: '', type: '', status: '', search: '' })
                  }}
                >
                  Zrušit filtry
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : phone ? (
        // Telefon: jedna karta = jedna otázka. Stav, body i akce jsou v ní,
        // takže se nic neschová za okraj obrazovky.
        <ul className="mt-3 space-y-2">
          <li className="flex items-center gap-2 pb-1 text-sm text-fg-muted">
            <Checkbox
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              onCheckedChange={toggleAll}
              aria-label={`Vybrat vše viditelné (${rows.length})`}
            />
            Vybrat vše viditelné
          </li>
          {rows.map((row) => {
            const topic = row.topicId ? topicById.get(row.topicId) : undefined
            return (
              // Id otázky je v atributu, aby se dal v testech spárovat řádek
              // se záznamem v databázi; v rozhraní nic neznamená.
              <li
                key={row.id}
                data-question-id={row.id}
                className="rounded-[var(--radius-inner)] border border-line-soft p-3"
              >
                <div className="flex items-start gap-2">
                  <Checkbox
                    className="mt-0.5"
                    checked={selected.has(row.id)}
                    onCheckedChange={() => toggle(row.id)}
                    aria-label={`Vybrat otázku ${promptOf(row)}`}
                  />
                  <p className="min-w-0 flex-1 text-sm break-words text-fg">{promptOf(row)}</p>
                  <QuestionActions
                    question={row}
                    label={promptOf(row)}
                    onEdit={row.topicId ? () => setEditing(row) : null}
                    onChanged={() => startRefresh(() => router.refresh())}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-soft">
                  {row.status === 'draft' ? (
                    <Badge className="bg-draft-bg text-draft-fg">koncept</Badge>
                  ) : null}
                  {row.status === 'approved' ? <Badge>schváleno</Badge> : null}
                  {row.status === 'rejected' ? <Badge variant="destructive">zamítnuto</Badge> : null}
                  <span>{QUESTION_TYPE_LABELS[row.type]}</span>
                  <span aria-hidden="true">·</span>
                  <span className="ui-numeric">{row.points} b.</span>
                  <span aria-hidden="true">·</span>
                  {topic ? (
                    <Link href={`/topics/${topic.id}`} className="break-words text-brand hover:underline">
                      {topic.label}
                    </Link>
                  ) : (
                    <span className="text-fg-muted">bez tématu</span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line-soft text-fg-muted">
                <th className="py-2 pr-3 font-medium">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAll}
                    aria-label={`Vybrat vše viditelné (${rows.length})`}
                  />
                </th>
                <th className="py-2 pr-4 font-medium">Otázka</th>
                <th className="py-2 pr-4 font-medium">Typ</th>
                <th className="py-2 pr-4 font-medium">Stav</th>
                <th className="py-2 pr-4 font-medium">Body</th>
                <th className="py-2 pr-4 font-medium">Téma</th>
                <th className="py-2 pr-0 font-medium text-right">Akce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {rows.map((row) => {
                const topic = row.topicId ? topicById.get(row.topicId) : undefined
                return (
                  // Id otázky je v atributu, aby se dal v testech spárovat
                  // řádek se záznamem v databázi; v rozhraní nic neznamená.
                  <tr key={row.id} data-question-id={row.id}>
                    <td className="py-2 pr-3">
                      <Checkbox
                        checked={selected.has(row.id)}
                        onCheckedChange={() => toggle(row.id)}
                        aria-label={`Vybrat otázku ${promptOf(row)}`}
                      />
                    </td>
                    <td className="max-w-sm truncate py-2 pr-4 text-fg">{promptOf(row)}</td>
                    <td className="py-2 pr-4 text-fg-soft">{QUESTION_TYPE_LABELS[row.type]}</td>
                    <td className="py-2 pr-4">
                      {row.status === 'draft' ? (
                        <Badge className="bg-draft-bg text-draft-fg">koncept</Badge>
                      ) : null}
                      {row.status === 'approved' ? <Badge>schváleno</Badge> : null}
                      {row.status === 'rejected' ? <Badge variant="destructive">zamítnuto</Badge> : null}
                    </td>
                    <td className="ui-numeric py-2 pr-4 text-fg-soft">{row.points}</td>
                    <td className="py-2 pr-4">
                      {topic ? (
                        <Link href={`/topics/${topic.id}`} className="text-brand hover:underline">
                          {topic.label}
                        </Link>
                      ) : (
                        <span className="text-fg-muted">bez tématu</span>
                      )}
                    </td>
                    <td className="py-2 pr-0">
                      <div className="flex items-center justify-end gap-1">
                        {/* Otázka bez tématu se upravovat nedá — editor ukládá
                            právě do tématu a neměl by kam. */}
                        <QuestionActions
                          question={row}
                          label={promptOf(row)}
                          onEdit={row.topicId ? () => setEditing(row) : null}
                          onChanged={() => startRefresh(() => router.refresh())}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {cursor ? (
        <div className="mt-3 flex justify-center">
          <BusyButton
            variant="outline"
            busy={loadingMore}
            busyLabel="Načítám…"
            onClick={() => void loadMore()}
          >
            Načíst další ({total - rows.length})
          </BusyButton>
        </div>
      ) : null}

      {navigating ? <p className="mt-2 text-sm text-fg-muted">Hledám…</p> : null}

      {editing && editing.topicId ? (
        <QuestionEditor
          topicId={editing.topicId}
          question={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            startRefresh(() => router.refresh())
          }}
        />
      ) : null}
    </Card>
  )
}
