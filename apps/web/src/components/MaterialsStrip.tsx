'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileUp, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { ExtractedMaterial } from '@testmaker/core/schema'
import { DeleteFromLibrary } from '@/components/DeleteFromLibrary'
import { useMuzeMenit } from '@/components/Prava'
import { MaterialRow, type GroupMaterial } from '@/components/MaterialRow'
import { IssueList, SKIP_LABELS, type IssueItem } from '@/components/importIssues'
import {
  entriesFromInput,
  extractAll,
  filesFromDrop,
  triageEntries,
  uploadMaterials,
  type FileEntry,
} from '@/lib/importClient'
import {
  BusyButton,
  Button,
  cn,
  Card,
  Input,
  Label,
  MATERIALY,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  pocet,
  toast,
} from '@testmaker/ui'

export type { GroupMaterial } from '@/components/MaterialRow'

type UploadPhase = 'idle' | 'extracting' | 'uploading'

/**
 * Pruh materiálů jednoho tématu. Nahrávání souborů rovnou sem, přepnutí
 * „Použít pro generování", smazání a — v režimu „Upravit téma" — přejmenování,
 * přesun mezi tématy, sloučení a smazání celého tématu.
 *
 * Všechno se tu jmenuje „téma" — navigace, dlaždice i filtry mluví o tématu a
 * druhé jméno („skupina") pro touž věc vedlo k tomu, že si učitelka před
 * „Smazat skupinu" nebyla jistá, jestli maže totéž, co jinde téma.
 */
export function MaterialsStrip({
  topicId,
  topicName,
  materials,
}: {
  topicId: string
  topicName: string
  materials: GroupMaterial[]
}) {
  const router = useRouter()
  const muzeMenit = useMuzeMenit()
  const filesRef = useRef<HTMLInputElement>(null)

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
  // Sbalený, jakmile v tématu materiály jsou — na obrazovce jde hlavně o
  // otázky. Bez materiálů se rovnou ukazuje nahrávací plocha, ať učitelka
  // hned ví, kudy začít.
  const [open, setOpen] = useState(materials.length === 0)
  const [error, setError] = useState<string | null>(null)

  const [dragging, setDragging] = useState(false)
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [skipped, setSkipped] = useState<IssueItem[]>([])
  const [failed, setFailed] = useState<IssueItem[]>([])

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

  /** Extrahuje soubory v prohlížeči a nahraje je rovnou do tohoto tématu. */
  async function handleFiles(entries: FileEntry[]) {
    if (entries.length === 0) return
    setError(null)
    setOpen(true)

    const { accepted, skipped: skippedFiles } = triageEntries(entries)
    setSkipped(skippedFiles.map((item) => ({ ...item, reason: SKIP_LABELS[item.reason] ?? item.reason })))
    setFailed([])

    if (accepted.length === 0) return

    setUploadPhase('extracting')
    setProgress({ done: 0, total: accepted.length })

    const extracted: ExtractedMaterial[] = []
    const failures: IssueItem[] = []
    let done = 0

    try {
      await extractAll(accepted, (result) => {
        done += 1
        setProgress({ done, total: accepted.length })
        if (result.status === 'ok' && result.material) extracted.push(result.material)
        else if (result.status === 'error') {
          failures.push({ relativePath: result.relativePath, reason: result.reason ?? 'chyba' })
        }
      })
    } catch (workerError) {
      setError(workerError instanceof Error ? workerError.message : String(workerError))
    }
    setFailed(failures)

    if (extracted.length === 0) {
      setUploadPhase('idle')
      return
    }

    setUploadPhase('uploading')
    setProgress({ done: 0, total: extracted.length })
    try {
      const result = await uploadMaterials(extracted, {
        topicId,
        onProgress: (uploadDone, uploadTotal) => setProgress({ done: uploadDone, total: uploadTotal }),
      })
      toast.success(
        result.duplicates > 0
          ? `Nahráno ${pocet(result.imported, MATERIALY)} (${result.duplicates} už v tématu bylo).`
          : `Nahráno ${pocet(result.imported, MATERIALY)}.`,
      )
      router.refresh()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError))
    } finally {
      setUploadPhase('idle')
    }
  }

  const uploadBusy = uploadPhase !== 'idle'
  // Do generování nejde duplicitní obsah ani materiál ručně vyřazený —
  // oboje se v hlavičce sečte jedním číslem, ať se počty nemusí luštit dva.
  const active = materials.filter((material) => !material.duplicateOfId && !material.excluded)
  const skippedCount = materials.length - active.length

  return (
    <Card className="gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-fg"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown className={cn('size-4 transition-transform', open ? '' : '-rotate-90')} aria-hidden />
          Materiály
          <span className="font-normal text-fg-muted">
            {active.length}
            {skippedCount > 0 ? ` + ${skippedCount} vynechaných` : ''}
          </span>
        </button>
        {muzeMenit ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (!manage) {
                setOptionsReady(false)
                setOpen(true)
              }
              setManage(!manage)
            }}
          >
            {manage ? 'Hotovo' : 'Upravit téma'}
          </Button>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

      {open ? (
        <div className="mt-2 space-y-3">
          {muzeMenit ? (
            <div
              className={cn(
                'flex flex-col items-center gap-2 rounded-md border border-dashed border-line-soft p-4 text-center transition-colors',
                dragging && 'border-brand bg-brand-bg',
              )}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                if (uploadBusy) return
                void filesFromDrop(event.dataTransfer).then(handleFiles)
              }}
            >
              <input
                ref={filesRef}
                type="file"
                multiple
                className="hidden"
                data-testid="topic-material-files"
                onChange={(event) => {
                  void handleFiles(entriesFromInput(event.target.files))
                  event.target.value = ''
                }}
              />
              <Button size="sm" variant="outline" disabled={uploadBusy} onClick={() => filesRef.current?.click()}>
                <FileUp className="size-4" aria-hidden />
                Nahrát materiály
              </Button>
              <p className="text-xs text-fg-muted">Nebo sem soubory přetáhni myší.</p>

              {uploadBusy ? (
                <div className="w-full max-w-sm space-y-1">
                  <p className="text-xs text-fg-soft">
                    <Loader2 className="mr-1 inline size-3.5 animate-spin" />
                    {uploadPhase === 'extracting' ? 'Čtu soubory' : 'Ukládám'}: {progress.done} / {progress.total}
                  </p>
                  <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
                </div>
              ) : null}
            </div>
          ) : null}

          {failed.length > 0 ? <IssueList title={`Nepodařilo se přečíst (${failed.length})`} items={failed} kind="danger" /> : null}
          {skipped.length > 0 ? <IssueList title={`Přeskočeno (${skipped.length})`} items={skipped} kind="neutral" /> : null}

          {materials.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {materials.map((material) => (
                <MaterialRow
                  key={material.id}
                  material={material}
                  originalFileName={materials.find((row) => row.id === material.duplicateOfId)?.fileName ?? null}
                  manage={manage}
                  siblings={siblings}
                  optionsReady={optionsReady}
                  busy={busy}
                  onMove={(target) => void call('PUT', { materialId: material.id, topicId: target })}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {open && manage ? (
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
