'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DeleteFromLibrary } from '@/components/DeleteFromLibrary'
import {
  Badge,
  BusyButton,
  Button,
  DeleteButton,
  cn,
  Card,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@testmaker/ui'

export interface GroupMaterial {
  id: string
  fileName: string
  charCount: number
  pageCount: number | null
  needsOcr: boolean
  duplicateOfId: string | null
  duplicateScore: number | null
}

/**
 * Materiály jednoho tématu. Učitelka téma může přejmenovat, sloučit s jiným
 * tématem téhož ročníku nebo z něj jednotlivý materiál vyjmout.
 *
 * Všechno se tu jmenuje „téma“ — navigace, dlaždice i filtry mluví o tématu a
 * druhé jméno („skupina“) pro touž věc vedlo k tomu, že si učitelka před
 * „Smazat skupinu“ nebyla jistá, jestli maže totéž, co jinde téma.
 */
export function TopicGroup({
  topicId,
  topicName,
  materials,
}: {
  topicId: string
  topicName: string
  materials: GroupMaterial[]
}) {
  const router = useRouter()
  const [name, setName] = useState(topicName)
  const [siblings, setSiblings] = useState<{ id: string; name: string }[]>([])
  const [gradeOptions, setGradeOptions] = useState<{ id: string; name: string }[]>([])
  const [currentGrade, setCurrentGrade] = useState('')
  const [newGrade, setNewGrade] = useState('')
  const [addingGrade, setAddingGrade] = useState(false)
  const [mergeTarget, setMergeTarget] = useState('')
  // Nabídky sourozeneckých témat a ročníků se dotahují až při otevření
  // úprav. Než dojdou, jsou rozbalovací seznamy prázdné — kdyby zůstaly
  // ovladatelné, otevřely by se do prázdna a vypadalo by to jako chyba.
  const [optionsReady, setOptionsReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [manage, setManage] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!manage) return
    // Shození příznaku patří k přepnutí do úprav, ne sem: stav se nemá měnit
    // synchronně v efektu (React to hlásí jako řetězení překreslení).
    void Promise.all([
      fetch(`/api/topics?siblingsOf=${encodeURIComponent(topicId)}`)
        .then((response) => response.json())
        .then((data: { topics: { id: string; name: string }[] }) => setSiblings(data.topics)),
      fetch(`/api/topics?gradesOf=${encodeURIComponent(topicId)}`)
        .then((response) => response.json())
        .then((data: { grades: { id: string; name: string }[]; currentGrade: string }) => {
          setGradeOptions(data.grades)
          setCurrentGrade(data.currentGrade)
        }),
    ]).finally(() => setOptionsReady(true))
  }, [manage, topicId])

  async function call(method: string, body: unknown) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/topics', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      // Server odmítne třeba přesun souboru tam, kde tentýž obsah už je.
      // Bez téhle hlášky to vypadalo, že se prostě nic nestalo.
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))) as { error?: string }
        setError(detail.error ?? `Nepovedlo se to (${response.status}).`)
        return
      }
      router.refresh()
    } catch (networkError) {
      setError(networkError instanceof Error ? networkError.message : String(networkError))
    } finally {
      setBusy(false)
    }
  }

  const active = materials.filter((material) => !material.duplicateOfId)

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Bez počtu: ten je nahoře u názvu tématu. Zůstává jen údaj, který
            jinde není — kolik souborů se přeskakuje jako duplicitní. */}
        <h2 className="text-sm font-semibold text-fg">
          Materiály
          {materials.length !== active.length ? (
            <span className="ml-2 font-normal text-fg-muted">
              {materials.length - active.length} duplicitních se vynechává
            </span>
          ) : null}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            if (!manage) setOptionsReady(false)
            setManage(!manage)
          }}
        >
          {manage ? 'Hotovo' : 'Upravit téma'}
        </Button>
      </div>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

      <ul className="mt-2 space-y-1 text-sm">
        {materials.map((material) => {
          const original = materials.find((row) => row.id === material.duplicateOfId)
          return (
            <li key={material.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {/* Názvy souborů bývají dlouhé a bez mezer, proto se musí zalomit i uprostřed slova. */}
              <span
                className={cn(
                  'min-w-0 break-all',
                  material.duplicateOfId ? 'text-fg-muted' : 'text-fg-soft',
                )}
                title={material.fileName}
              >
                {material.fileName}
              </span>
              <span className="shrink-0 text-fg-muted">
                {material.charCount.toLocaleString('cs')} znaků
                {material.pageCount ? `, ${material.pageCount} str.` : ''}
              </span>
              {material.needsOcr ? (
                <Badge className="shrink-0 bg-draft-bg text-draft-fg">skoro bez textu</Badge>
              ) : null}
              {material.duplicateOfId ? (
                <span className="min-w-0 break-all text-xs text-fg-muted">
                  stejný obsah jako {original?.fileName ?? 'jiný materiál'}
                  {material.duplicateScore ? ` (shoda ${Math.round(material.duplicateScore * 100)} %)` : ''}
                </span>
              ) : null}
              {manage && (!optionsReady || siblings.length > 0) ? (
                <Select
                  value="presun"
                  disabled={busy || !optionsReady}
                  onValueChange={(value) =>
                    value !== 'presun' && void call('PUT', { materialId: material.id, topicId: value })
                  }
                >
                  <SelectTrigger className="ml-auto w-full shrink-0 sm:w-56" aria-busy={!optionsReady || undefined}>
                    {optionsReady ? <SelectValue /> : <span className="text-fg-muted">Načítám témata…</span>}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="presun">Přesunout do…</SelectItem>
                    {siblings.map((sibling) => (
                      <SelectItem key={sibling.id} value={sibling.id}>
                        {sibling.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {manage ? (
                <DeleteButton
                  label="Smazat"
                  title="Smazat materiál?"
                  description={`Materiál „${material.fileName}" zmizí z tématu. Otázky, které z něj vznikly, zůstanou.`}
                  onConfirm={async () => {
                    await fetch(`/api/materials?id=${encodeURIComponent(material.id)}`, { method: 'DELETE' })
                    router.refresh()
                  }}
                />
              ) : null}
            </li>
          )
        })}
      </ul>

      {manage ? (
        <div className="mt-4 grid gap-3 border-t border-line-soft pt-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="topic-group-name">Název tématu</Label>
            <div className="flex gap-2">
              <Input id="topic-group-name" value={name} onChange={(event) => setName(event.target.value)} />
              <BusyButton
                size="sm"
                variant="outline"
                busy={busy}
                busyLabel="Ukládám…"
                disabled={!name.trim() || name === topicName}
                onClick={() => void call('PATCH', { id: topicId, name })}
              >
                Uložit
              </BusyButton>
            </div>
          </div>
          <div>
            <Label htmlFor="topic-group-grade">Ročník</Label>
            <Select
              value={addingGrade ? 'novy' : currentGrade === '' ? 'bez-rocniku' : currentGrade}
              onValueChange={(value) => {
                if (value === 'novy') {
                  setAddingGrade(true)
                  setNewGrade('')
                  return
                }
                setAddingGrade(false)
                void call('PATCH', { id: topicId, gradeName: value === 'bez-rocniku' ? '' : value })
              }}
            >
              <SelectTrigger id="topic-group-grade" className="w-full" disabled={!optionsReady}>
                {optionsReady ? <SelectValue /> : <span className="text-fg-muted">Načítám ročníky…</span>}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bez-rocniku">Bez ročníku</SelectItem>
                {gradeOptions
                  .filter((grade) => grade.name !== '')
                  .map((grade) => (
                    <SelectItem key={grade.id} value={grade.name}>
                      {grade.name}
                    </SelectItem>
                  ))}
                <SelectItem value="novy">Jiný ročník…</SelectItem>
              </SelectContent>
            </Select>

            {addingGrade ? (
              <div className="mt-2 flex gap-2">
                <Input
                  aria-label="Název nového ročníku"
                  placeholder="Např. 8. ročník"
                  value={newGrade}
                  onChange={(event) => setNewGrade(event.target.value)}
                />
                <BusyButton
                  size="sm"
                  variant="outline"
                  busy={busy}
                  busyLabel="Přeřazuji…"
                  disabled={!newGrade.trim()}
                  onClick={() => {
                    setAddingGrade(false)
                    void call('PATCH', { id: topicId, gradeName: newGrade })
                  }}
                >
                  Přeřadit
                </BusyButton>
              </div>
            ) : null}

            <p className="mt-1 text-xs text-fg-muted">
              Přeřadí celé téma i s materiály a otázkami do zvoleného ročníku téhož předmětu.
              Ročník, který ještě neexistuje, se založí.
            </p>
          </div>
          <div>
            <Label htmlFor="topic-group-merge-target">Sloučit do jiného tématu</Label>
            <div className="flex gap-2">
              <Select value={mergeTarget || 'zadna'} onValueChange={(value) => setMergeTarget(value === 'zadna' ? '' : value)}>
                <SelectTrigger id="topic-group-merge-target" className="w-full" disabled={!optionsReady}>
                  {optionsReady ? <SelectValue /> : <span className="text-fg-muted">Načítám témata…</span>}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zadna">Vyber téma…</SelectItem>
                  {siblings.map((sibling) => (
                    <SelectItem key={sibling.id} value={sibling.id}>
                      {sibling.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <BusyButton
                size="sm"
                variant="outline"
                busy={busy}
                busyLabel="Slučuji…"
                disabled={!mergeTarget}
                onClick={() => void call('POST', { sourceId: topicId, targetId: mergeTarget })}
              >
                Sloučit
              </BusyButton>
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              Materiály i otázky se přesunou do vybraného tématu, toto zanikne.
            </p>
          </div>
          <div className="sm:col-span-2 flex items-center justify-between gap-2 border-t border-line-soft pt-3">
            <p className="text-xs text-fg-muted">
              Smazání tématu odstraní i jeho materiály a otázky. Soubory na disku zůstanou.
            </p>
            <DeleteFromLibrary kind="topic" id={topicId} label="Smazat téma" redirectTo="/" />
          </div>
        </div>
      ) : null}
    </Card>
  )
}
