'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
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
import { isUsableMaterial } from '@/lib/materials'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
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
  plural,
  pocet,
  toast,
} from '@testmaker/ui'

export type { GroupMaterial } from '@/components/MaterialRow'

type UploadPhase = 'idle' | 'extracting' | 'uploading'

export interface MaterialsStripHandle {
  /**
   * Otevře nahrávání souborů zvenčí — z prázdného stavu tématu, kde pruh sám
   * není vidět (`EmptyState` v `TopicWorkspace` ho nahrazuje).
   */
  openUpload: () => void
  /**
   * Přetažení souboru mimo vlastní zónu pruhu — `TopicWorkspace` přebírá
   * přetažení nad celou plochou tématu (jinak by ho prohlížeč otevřel jako
   * novou stránku) a posílá ho sem, jako by dopadlo přímo do zóny.
   */
  handleExternalDrop: (dataTransfer: DataTransfer) => void
}

/**
 * Pruh materiálů jednoho tématu. Nahrávání souborů rovnou sem, přepnutí
 * „Použít pro generování", smazání a — v režimu „Upravit téma" — přejmenování,
 * přesun mezi tématy, sloučení a smazání celého tématu.
 *
 * Všechno se tu jmenuje „téma" — navigace, dlaždice i filtry mluví o tématu a
 * druhé jméno („skupina") pro touž věc vedlo k tomu, že si učitelka před
 * „Smazat skupinu" nebyla jistá, jestli maže totéž, co jinde téma.
 */
export const MaterialsStrip = forwardRef<
  MaterialsStripHandle,
  {
    topicId: string
    topicName: string
    materials: GroupMaterial[]
    /** Karta generování v tématu podle tohodle zakazuje tlačítko, dokud se soubory nahrávají. */
    onBusyChange?: (busy: boolean) => void
  }
>(function MaterialsStrip({ topicId, topicName, materials, onBusyChange }, ref) {
  const router = useRouter()
  const muzeMenit = useMuzeMenit()
  const filesRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(topicName)
  // Přejmenování nadpisem tématu (`InlineName`) mění `topicName` zvenčí —
  // bez převzetí by tlačítko Uložit vrátilo starý název zpátky.
  const [lastTopicName, setLastTopicName] = useState(topicName)
  if (topicName !== lastTopicName) {
    setLastTopicName(topicName)
    setName(topicName)
  }
  const [siblings, setSiblings] = useState<{ id: string; name: string }[]>([])
  const [gradeOptions, setGradeOptions] = useState<{ id: string; name: string }[]>([])
  const [currentGrade, setCurrentGrade] = useState('')
  const [newGrade, setNewGrade] = useState('')
  const [addingGrade, setAddingGrade] = useState(false)
  const [mergeTarget, setMergeTarget] = useState('')
  const [mergeOpen, setMergeOpen] = useState(false)
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

  useImperativeHandle(ref, () => ({
    openUpload: () => {
      setOpen(true)
      filesRef.current?.click()
    },
    handleExternalDrop: (dataTransfer: DataTransfer) => {
      if (uploadPhase !== 'idle') return
      setOpen(true)
      void filesFromDrop(dataTransfer).then(handleFiles)
    },
  }))

  const uploadBusy = uploadPhase !== 'idle'

  // Karta generování v tématu tlačítko zakáže, dokud se soubory nahrávají —
  // jinak by šlo spustit generování nad textem, který ještě není celý uložený.
  useEffect(() => {
    onBusyChange?.(uploadBusy)
  }, [uploadBusy, onBusyChange])

  // Zavření nebo obnovení stránky uprostřed čtení či ukládání souborů
  // znamenalo ztrátu rozpracovaného nahrávání bez varování.
  useEffect(() => {
    if (!uploadBusy) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [uploadBusy])

  useEffect(() => {
    if (!manage) return
    // Shození příznaku patří k přepnutí do úprav, ne sem: stav se nemá měnit
    // synchronně v efektu (React to hlásí jako řetězení překreslení).
    const failure = 'Nabídku témat a ročníků se nepodařilo načíst.'
    void Promise.all([
      requestJson<{ topics: { id: string; name: string }[] }>(
        `/api/topics?siblingsOf=${encodeURIComponent(topicId)}`,
        undefined,
        failure,
      ).then((data) => setSiblings(data.topics ?? [])),
      requestJson<{ grades: { id: string; name: string }[]; currentGrade: string }>(
        `/api/topics?gradesOf=${encodeURIComponent(topicId)}`,
        undefined,
        failure,
      ).then((data) => {
        setGradeOptions(data.grades ?? [])
        setCurrentGrade(data.currentGrade ?? '')
      }),
    ])
      .catch((loadError: unknown) =>
        setError(`${errorMessage(loadError, failure)} Klikni na Hotovo a otevři úpravy znovu.`),
      )
      .finally(() => setOptionsReady(true))
  }, [manage, topicId])

  /** Uloží změnu tématu a ohlásí ji; vrací, jestli se to povedlo. Chybu ukáže v pruhu. */
  async function call(method: string, body: unknown, success: string): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      // Server odmítne třeba přesun souboru tam, kde tentýž obsah už je.
      // Bez téhle hlášky to vypadalo, že se prostě nic nestalo.
      await requestJson('/api/topics', jsonBody(method, body), 'Změnu se nepodařilo uložit.')
      toast.success(success)
      return true
    } catch (callError) {
      setError(errorMessage(callError, 'Změnu se nepodařilo uložit.'))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function update(method: string, body: unknown, success: string) {
    if (await call(method, body, success)) router.refresh()
  }

  async function merge() {
    const targetName = siblings.find((sibling) => sibling.id === mergeTarget)?.name ?? 'vybraného tématu'
    const merged = await call('POST', { sourceId: topicId, targetId: mergeTarget }, `Téma sloučeno do „${targetName}“.`)
    setMergeOpen(false)
    // Sloučené téma zaniklo — obnovení téže stránky by skončilo na „nenalezeno“.
    if (merged) router.push(`/topics/${mergeTarget}`)
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
    // Extrakce doběhne, ale soubor nemá žádný text (`status: 'skipped'` z
    // `processFile`) — patří mezi přeskočené vedle těch, co se vyřadily už
    // podle přípony, jinak takový soubor beze stopy zmizí.
    const emptySkips: IssueItem[] = []
    let done = 0

    try {
      await extractAll(accepted, (result) => {
        done += 1
        setProgress({ done, total: accepted.length })
        if (result.status === 'ok' && result.material) extracted.push(result.material)
        else if (result.status === 'error') {
          failures.push({ relativePath: result.relativePath, reason: result.reason ?? 'chyba' })
        } else if (result.status === 'skipped') {
          emptySkips.push({
            relativePath: result.relativePath,
            reason: SKIP_LABELS[result.reason ?? ''] ?? 'soubor neobsahuje žádný text',
          })
        }
      })
    } catch (workerError) {
      setError(errorMessage(workerError, 'Soubory se nepodařilo přečíst.'))
    }
    setFailed(failures)
    if (emptySkips.length > 0) setSkipped((current) => [...current, ...emptySkips])

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
      toast.success(uploadSummaryMessage(result))
      // Sken bez textové vrstvy se do knihovny uloží (učitelka ho třeba
      // nahradí lepší verzí), ale otázky z něj nikdy nevzniknou — na to má
      // upozornit hned, ne až u zaškrtávátka v pruhu.
      for (const material of extracted) {
        if (material.needsOcr) {
          toast(`„${material.fileName}" je nejspíš sken bez textu — otázky z něj nevzniknou.`)
        }
      }
      router.refresh()
    } catch (uploadError) {
      setError(errorMessage(uploadError, 'Soubory se nepodařilo uložit.'))
    } finally {
      setUploadPhase('idle')
    }
  }

  // Do generování nejde duplicitní obsah, materiál ručně vyřazený ani sken
  // bez textové vrstvy — všechno se v hlavičce sečte jedním číslem, ať se
  // počty nemusí luštit dva.
  const active = materials.filter(isUsableMaterial)
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
          Materiály{' '}
          <span className="font-normal text-fg-muted">
            {active.length}
            {skippedCount > 0
              ? ` + ${skippedCount} ${plural(skippedCount, 'vynechaný', 'vynechané', 'vynechaných')}`
              : ''}
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
                // Vlastní zóna přetažení soubor zpracuje sama — nesmí probublat
                // do obslužné rutiny na celé ploše tématu, jinak by se tentýž
                // soubor nahrál dvakrát.
                event.stopPropagation()
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
                  <p className="text-xs text-fg-muted">Nechte stránku otevřenou, než se soubory nahrají.</p>
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
                  onMove={(target) =>
                    void update(
                      'PUT',
                      { materialId: material.id, topicId: target },
                      `Materiál přesunut do „${siblings.find((sibling) => sibling.id === target)?.name ?? 'vybraného tématu'}“.`,
                    )
                  }
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
                onClick={() => void update('PATCH', { id: topicId, name }, 'Téma přejmenováno.')}
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
                void update(
                  'PATCH',
                  { id: topicId, gradeName: value === 'bez-rocniku' ? '' : value },
                  value === 'bez-rocniku' ? 'Téma přeřazeno mezi témata bez ročníku.' : `Téma přeřazeno do ročníku ${value}.`,
                )
              }}
            >
              <SelectTrigger id="topic-group-grade" className="w-full" disabled={!optionsReady || busy}>
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
                    void update('PATCH', { id: topicId, gradeName: newGrade }, `Téma přeřazeno do ročníku ${newGrade.trim()}.`)
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
              {/* Sloučení je nevratné: téma zmizí a materiály, které cíl už má,
                  se zahodí — proto se ptá stejně jako mazání. */}
              <AlertDialog open={mergeOpen} onOpenChange={(next) => !busy && setMergeOpen(next)}>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={!mergeTarget || busy}>
                    Sloučit
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Sloučit „{topicName}“ do „{siblings.find((sibling) => sibling.id === mergeTarget)?.name}“?
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2">
                        <p>
                          Materiály i otázky se přesunou do vybraného tématu a téma „{topicName}“ zmizí.
                          Materiály se stejným obsahem, jaký cílové téma už má, se smažou.
                        </p>
                        <p className="text-fg-muted">Akci nejde vrátit zpět.</p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>Zrušit</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={busy}
                      aria-busy={busy || undefined}
                      onClick={(event) => {
                        event.preventDefault()
                        void merge()
                      }}
                    >
                      {busy ? 'Slučuji…' : 'Sloučit'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
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
})

/**
 * Hláška po nahrání do tématu. Když se nenaimportovalo nic (všechny soubory
 * v tématu už byly), obecná věta o duplicitách by zněla, že se nestalo nic —
 * proto má vlastní znění. Sloveso se skloňuje podle počtu duplicit, ať
 * nevznikne „1 už v tématu bylo“.
 */
function uploadSummaryMessage(result: { imported: number; duplicates: number }): string {
  if (result.imported === 0) return 'Všechny soubory už v tématu byly.'
  if (result.duplicates > 0) {
    const bylo = plural(result.duplicates, 'byl', 'byly', 'bylo')
    return `Nahráno ${pocet(result.imported, MATERIALY)} (${result.duplicates} už v tématu ${bylo}).`
  }
  return `Nahráno ${pocet(result.imported, MATERIALY)}.`
}
