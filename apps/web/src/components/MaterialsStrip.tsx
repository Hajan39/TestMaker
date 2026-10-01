'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ChevronDown, FileUp, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { ExtractedMaterial } from '@testmaker/core/schema'
import { DeleteFromLibrary } from '@/components/DeleteFromLibrary'
import { useCanEdit } from '@/components/Permissions'
import { MaterialRow, type GroupMaterial } from '@/components/MaterialRow'
import { IssueList, skipLabel, type IssueItem } from '@/components/importIssues'
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
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

export type { GroupMaterial } from '@/components/MaterialRow'

type UploadPhase = 'idle' | 'extracting' | 'uploading'

export interface MaterialsStripHandle {
  /**
   * Opens the file upload from outside — from the topic's empty state, where
   * the strip itself isn't visible (`EmptyState` in `TopicWorkspace` replaces it).
   */
  openUpload: () => void
  /**
   * A file dropped outside the strip's own zone — `TopicWorkspace` catches
   * drops over the whole topic area (otherwise the browser would open the file
   * as a new page) and forwards them here as if dropped into the zone.
   */
  handleExternalDrop: (dataTransfer: DataTransfer) => void
}

/**
 * The materials strip of one topic. Upload files straight here, toggle
 * "Použít pro generování", delete and — in "Upravit téma" mode — rename, move
 * between topics, merge and delete the whole topic.
 *
 * Everything here is called "téma" — navigation, tiles and filters all talk
 * about a topic, and a second name ("skupina") for the same thing left the
 * teacher unsure whether "Smazat skupinu" deleted the same thing as a topic elsewhere.
 */
export const MaterialsStrip = forwardRef<
  MaterialsStripHandle,
  {
    topicId: string
    topicName: string
    materials: GroupMaterial[]
    /** The topic's generation card uses this to disable its button while files upload. */
    onBusyChange?: (busy: boolean) => void
  }
>(function MaterialsStrip({ topicId, topicName, materials, onBusyChange }, ref) {
  const router = useRouter()
  const canEdit = useCanEdit()
  const filesRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(topicName)
  // Renaming via the topic heading (`InlineName`) changes `topicName` from
  // outside — without adopting it, the Save button would restore the old name.
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
  // Sibling topic and grade options load only when editing opens. Until they
  // arrive the dropdowns are empty — if they stayed usable they would open
  // empty and look like a bug.
  const [optionsReady, setOptionsReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [manage, setManage] = useState(false)
  // Collapsed once the topic has materials — the screen is mainly about
  // questions. Without materials the upload area shows right away, so the
  // teacher knows where to start.
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

  // The topic's generation card disables its button while files upload —
  // otherwise generation could start over text that isn't fully saved yet.
  useEffect(() => {
    onBusyChange?.(uploadBusy)
  }, [uploadBusy, onBusyChange])

  // Closing or reloading the page mid-read or mid-save used to lose the
  // upload in progress without a warning.
  useEffect(() => {
    if (!uploadBusy) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [uploadBusy])

  useEffect(() => {
    if (!manage) return
    // Resetting the flag belongs to switching into edit mode, not here: state
    // shouldn't change synchronously in an effect (React reports cascading renders).
    const failure = t('library:materialsStrip.optionsLoadFailed')
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
        setError(`${errorMessage(loadError, failure)} ${t('library:materialsStrip.optionsLoadHint')}`),
      )
      .finally(() => setOptionsReady(true))
  }, [manage, topicId])

  /** Saves a topic change and announces it; returns whether it worked. Shows errors in the strip. */
  async function call(method: string, body: unknown, success: string): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      // The server refuses e.g. moving a file where the same content already is.
      // Without this message it looked like nothing happened.
      await requestJson('/api/topics', jsonBody(method, body), t('library:materialsStrip.saveFailed'))
      toast.success(success)
      return true
    } catch (callError) {
      setError(errorMessage(callError, t('library:materialsStrip.saveFailed')))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function update(method: string, body: unknown, success: string) {
    if (await call(method, body, success)) router.refresh()
  }

  async function merge() {
    const targetName =
      siblings.find((sibling) => sibling.id === mergeTarget)?.name ?? t('library:materialsStrip.selectedTopic')
    const merged = await call(
      'POST',
      { sourceId: topicId, targetId: mergeTarget },
      t('library:materialsStrip.merged', { name: targetName }),
    )
    setMergeOpen(false)
    // The merged topic is gone — reloading the same page would end on "not found".
    if (merged) router.push(`/topics/${mergeTarget}`)
  }

  /** Extracts files in the browser and uploads them straight into this topic. */
  async function handleFiles(entries: FileEntry[]) {
    if (entries.length === 0) return
    setError(null)
    setOpen(true)

    const { accepted, skipped: skippedFiles } = triageEntries(entries)
    setSkipped(skippedFiles.map((item) => ({ ...item, reason: skipLabel(item.reason) ?? item.reason })))
    setFailed([])

    if (accepted.length === 0) return

    setUploadPhase('extracting')
    setProgress({ done: 0, total: accepted.length })

    const extracted: ExtractedMaterial[] = []
    const failures: IssueItem[] = []
    // Extraction finishes but the file has no text (`status: 'skipped'` from
    // `processFile`) — it belongs among the skipped next to those dropped by
    // extension, otherwise such a file vanishes without a trace.
    const emptySkips: IssueItem[] = []
    let done = 0

    try {
      await extractAll(accepted, (result) => {
        done += 1
        setProgress({ done, total: accepted.length })
        if (result.status === 'ok' && result.material) extracted.push(result.material)
        else if (result.status === 'error') {
          failures.push({ relativePath: result.relativePath, reason: result.reason ?? t('library:import.errorReason') })
        } else if (result.status === 'skipped') {
          emptySkips.push({
            relativePath: result.relativePath,
            reason: skipLabel(result.reason ?? '') ?? t('library:importIssues.skip.emptyText'),
          })
        }
      })
    } catch (workerError) {
      setError(errorMessage(workerError, t('library:import.readFailed')))
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
      // A scan without a text layer is saved to the library (the teacher may
      // replace it with a better version), but no questions ever come from it —
      // say so right away, not only at the strip's checkbox.
      for (const material of extracted) {
        if (material.needsOcr) {
          toast(t('library:materialsStrip.scanWarning', { name: material.fileName }))
        }
      }
      router.refresh()
    } catch (uploadError) {
      setError(errorMessage(uploadError, t('library:importClient.saveFailed')))
    } finally {
      setUploadPhase('idle')
    }
  }

  // Duplicate content, manually excluded materials and scans without a text
  // layer don't feed generation — the header sums them into one number so
  // there aren't two counts to decipher.
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
          {t('library:materialsStrip.title')}{' '}
          <span className="font-normal text-fg-muted">
            {active.length}
            {skippedCount > 0 ? t('library:materialsStrip.skippedSuffix', { count: skippedCount }) : ''}
          </span>
        </button>
        {canEdit ? (
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
            {manage ? t('common:actions.done') : t('library:materialsStrip.editTopic')}
          </Button>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}

      {open ? (
        <div className="mt-2 space-y-3">
          {canEdit ? (
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
                // The strip's own drop zone handles the file itself — it must not
                // bubble up to the handler over the whole topic area, or the same
                // file would upload twice.
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
                {t('library:materialsStrip.upload')}
              </Button>
              <p className="text-xs text-fg-muted">{t('library:materialsStrip.dropHint')}</p>

              {uploadBusy ? (
                <div className="w-full max-w-sm space-y-1">
                  <p className="text-xs text-fg-soft">
                    <Loader2 className="mr-1 inline size-3.5 animate-spin" />
                    {uploadPhase === 'extracting' ? t('library:import.reading') : t('library:import.saving')}:{' '}
                    {progress.done} / {progress.total}
                  </p>
                  <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
                  <p className="text-xs text-fg-muted">{t('library:materialsStrip.keepOpen')}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {failed.length > 0 ? (
            <IssueList title={t('library:import.failedTitle', { n: failed.length })} items={failed} kind="danger" />
          ) : null}
          {skipped.length > 0 ? (
            <IssueList title={t('library:import.skippedTitle', { n: skipped.length })} items={skipped} kind="neutral" />
          ) : null}

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
                      t('library:materialsStrip.moved', {
                        name:
                          siblings.find((sibling) => sibling.id === target)?.name ??
                          t('library:materialsStrip.selectedTopic'),
                      }),
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
            <Label htmlFor="topic-group-name">{t('library:materialsStrip.topicName')}</Label>
            <div className="flex gap-2">
              <Input id="topic-group-name" value={name} onChange={(event) => setName(event.target.value)} />
              <BusyButton
                size="sm"
                variant="outline"
                busy={busy}
                busyLabel={t('common:actions.saving')}
                disabled={!name.trim() || name === topicName}
                onClick={() => void update('PATCH', { id: topicId, name }, t('library:materialsStrip.renamed'))}
              >
                {t('common:actions.save')}
              </BusyButton>
            </div>
          </div>
          <div>
            <Label htmlFor="topic-group-grade">{t('library:import.grade')}</Label>
            <Select
              value={addingGrade ? 'new-grade' : currentGrade === '' ? 'no-grade' : currentGrade}
              onValueChange={(value) => {
                if (value === 'new-grade') {
                  setAddingGrade(true)
                  setNewGrade('')
                  return
                }
                setAddingGrade(false)
                void update(
                  'PATCH',
                  { id: topicId, gradeName: value === 'no-grade' ? '' : value },
                  value === 'no-grade'
                    ? t('library:materialsStrip.movedToNoGrade')
                    : t('library:materialsStrip.movedToGrade', { grade: value }),
                )
              }}
            >
              <SelectTrigger id="topic-group-grade" className="w-full" disabled={!optionsReady || busy}>
                {optionsReady ? <SelectValue /> : <span className="text-fg-muted">{t('library:materialsStrip.loadingGrades')}</span>}
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no-grade">{t('library:materialsStrip.noGrade')}</SelectItem>
                {gradeOptions
                  .filter((grade) => grade.name !== '')
                  .map((grade) => (
                    <SelectItem key={grade.id} value={grade.name}>
                      {grade.name}
                    </SelectItem>
                  ))}
                <SelectItem value="new-grade">{t('library:materialsStrip.otherGrade')}</SelectItem>
              </SelectContent>
            </Select>

            {addingGrade ? (
              <div className="mt-2 flex gap-2">
                <Input
                  aria-label={t('library:materialsStrip.newGradeName')}
                  placeholder={t('library:materialsStrip.newGradePlaceholder')}
                  value={newGrade}
                  onChange={(event) => setNewGrade(event.target.value)}
                />
                <BusyButton
                  size="sm"
                  variant="outline"
                  busy={busy}
                  busyLabel={t('library:materialsStrip.regrading')}
                  disabled={!newGrade.trim()}
                  onClick={() => {
                    setAddingGrade(false)
                    void update(
                      'PATCH',
                      { id: topicId, gradeName: newGrade },
                      t('library:materialsStrip.movedToGrade', { grade: newGrade.trim() }),
                    )
                  }}
                >
                  {t('library:materialsStrip.regrade')}
                </BusyButton>
              </div>
            ) : null}

            <p className="mt-1 text-xs text-fg-muted">{t('library:materialsStrip.regradeHint')}</p>
          </div>
          <div>
            <Label htmlFor="topic-group-merge-target">{t('library:materialsStrip.mergeLabel')}</Label>
            <div className="flex gap-2">
              <Select value={mergeTarget || 'none'} onValueChange={(value) => setMergeTarget(value === 'none' ? '' : value)}>
                <SelectTrigger id="topic-group-merge-target" className="w-full" disabled={!optionsReady}>
                  {optionsReady ? <SelectValue /> : <span className="text-fg-muted">{t('library:materialRow.loadingTopics')}</span>}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('library:materialsStrip.pickTopic')}</SelectItem>
                  {siblings.map((sibling) => (
                    <SelectItem key={sibling.id} value={sibling.id}>
                      {sibling.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Merging is irreversible: the topic disappears and materials the
                  target already has are discarded — so it asks just like delete. */}
              <AlertDialog open={mergeOpen} onOpenChange={(next) => !busy && setMergeOpen(next)}>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={!mergeTarget || busy}>
                    {t('library:materialsStrip.merge')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t('library:materialsStrip.mergeTitle', {
                        source: topicName,
                        target: siblings.find((sibling) => sibling.id === mergeTarget)?.name ?? '',
                      })}
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2">
                        <p>{t('library:materialsStrip.mergeDescription', { name: topicName })}</p>
                        <p className="text-fg-muted">{t('library:materialsStrip.irreversible')}</p>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>{t('common:actions.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={busy}
                      aria-busy={busy || undefined}
                      onClick={(event) => {
                        event.preventDefault()
                        void merge()
                      }}
                    >
                      {busy ? t('library:materialsStrip.merging') : t('library:materialsStrip.merge')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            <p className="mt-1 text-xs text-fg-muted">{t('library:materialsStrip.mergeHint')}</p>
          </div>
          <div className="sm:col-span-2 flex items-center justify-between gap-2 border-t border-line-soft pt-3">
            <p className="text-xs text-fg-muted">{t('library:materialsStrip.deleteHint')}</p>
            <DeleteFromLibrary kind="topic" id={topicId} label={t('library:materialsStrip.deleteTopic')} redirectTo="/" />
          </div>
        </div>
      ) : null}
    </Card>
  )
})

/**
 * Message after uploading into a topic. When nothing was imported (all files
 * were already in the topic), the general duplicates sentence would sound like
 * nothing happened — so it has its own wording. The verb agrees with the
 * duplicate count, so it never reads "1 už v tématu bylo".
 */
function uploadSummaryMessage(result: { imported: number; duplicates: number }): string {
  if (result.imported === 0) return t('library:materialsStrip.allAlreadyInTopic')
  const materials = t('library:count.materials', { count: result.imported })
  if (result.duplicates > 0) {
    return t('library:materialsStrip.uploadedWithDuplicates', {
      materials,
      duplicates: t('library:materialsStrip.duplicatesInTopic', { count: result.duplicates }),
    })
  }
  return t('library:materialsStrip.uploaded', { materials })
}
