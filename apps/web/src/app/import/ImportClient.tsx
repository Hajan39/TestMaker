'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ExtractedMaterial } from '@testmaker/core/schema'
import { groupForImport } from '@testmaker/core/extract'
import { FileUp, FolderUp, Loader2, Undo2 } from 'lucide-react'
import { Badge, Button, Card, Checkbox, cn, Input, Progress } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import {
  entriesFromInput,
  extractAll,
  filesFromDrop,
  lookupDestination,
  triageEntries,
  uploadMaterials,
  type FileEntry,
  type ImportDestination,
} from '@/lib/importClient'
import { IssueList, skipLabel, type IssueItem } from '@/components/importIssues'
import { errorMessage } from '@/lib/requestJson'

type Phase = 'idle' | 'extracting' | 'preview' | 'uploading' | 'done'

type Failure = IssueItem

/** Subjects and their grades as they already are in the library — for suggestions. */
export interface LibraryHint {
  subject: string
  grades: string[]
}

/** One file in the preview; `include` says whether it is sent. */
interface PreviewFile {
  key: string
  material: ExtractedMaterial
  include: boolean
}

/** A topic in the preview — its filing can be overridden, the whole topic left out. */
interface PreviewGroup {
  id: string
  subject: string
  grade: string
  topic: string
  include: boolean
  files: PreviewFile[]
}

/** Below this many characters the text most likely isn't enough for questions. */
const LOW_TEXT = 400

/** Without diacritics and letter case — so "PŘÍRODOPIS" finds "Přírodopis". */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('cs')
    .trim()
}

export function ImportClient({ library }: { library: LibraryHint[] }) {
  const router = useRouter()
  const folderRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [groups, setGroups] = useState<PreviewGroup[]>([])
  const [skipped, setSkipped] = useState<Failure[]>([])
  const [failed, setFailed] = useState<Failure[]>([])
  const [summary, setSummary] = useState<{ imported: number; duplicates: number } | null>(null)
  const [destinations, setDestinations] = useState<ImportDestination[]>([])
  const [error, setError] = useState<string | null>(null)

  const allSubjects = useMemo(() => library.map((hint) => hint.subject), [library])
  const allGrades = useMemo(
    () => [...new Set(library.flatMap((hint) => hint.grades))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'cs')),
    [library],
  )

  /** Grades of the chosen subject; for an unknown subject all grades in the library. */
  function gradeHints(subject: string): string[] {
    const own = library.find((hint) => fold(hint.subject) === fold(subject))?.grades.filter(Boolean)
    return own && own.length > 0 ? own : allGrades
  }

  /** A subject that differs from the typed one only by letter case or diacritics. */
  function nearDuplicateSubject(subject: string): string | null {
    if (!subject.trim()) return null
    const existing = allSubjects.find((name) => fold(name) === fold(subject))
    return existing && existing !== subject.trim() ? existing : null
  }

  const selected = useMemo(
    () =>
      groups
        .filter((group) => group.include)
        .flatMap((group) => group.files.filter((file) => file.include)),
    [groups],
  )

  async function handleEntries(entries: FileEntry[]) {
    if (entries.length === 0) return
    setError(null)
    setSummary(null)
    setDestinations([])
    setGroups([])
    setFailed([])

    const { accepted, skipped: skippedFiles } = triageEntries(entries)
    setSkipped(skippedFiles.map((item) => ({ ...item, code: item.reason, reason: skipLabel(item.reason) ?? item.reason })))

    if (accepted.length === 0) {
      setPhase('preview')
      return
    }

    setPhase('extracting')
    setProgress({ done: 0, total: accepted.length })

    const extracted: ExtractedMaterial[] = []
    const failures: Failure[] = []
    let done = 0
    // Extraction finishes but the file has no text (`status: 'skipped'` from
    // `processFile`) — it belongs among the skipped, otherwise it vanishes without a trace.
    const emptySkips: Failure[] = []

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
            code: result.reason,
            reason: skipLabel(result.reason ?? '') ?? t('library:importIssues.skip.emptyText'),
          })
        }
      })
    } catch (workerError) {
      setError(errorMessage(workerError, t('library:import.readFailed')))
    }

    setGroups(toPreview(extracted))
    setFailed(failures)
    if (emptySkips.length > 0) setSkipped((current) => [...current, ...emptySkips])
    setPhase('preview')
  }

  function update(groupId: string, change: Partial<PreviewGroup>) {
    setGroups((current) =>
      current.map((group) => (group.id === groupId ? { ...group, ...change } : group)),
    )
  }

  /**
   * Bulk filing: filled fields overwrite those of all included topics, empty
   * ones stay as they were. The same topic for all groups means the files
   * end up in a single topic on import.
   */
  function updateAll(change: Partial<Pick<PreviewGroup, 'subject' | 'grade' | 'topic'>>) {
    const filled = Object.fromEntries(
      Object.entries(change).filter(([, value]) => value && value.trim()),
    ) as Partial<PreviewGroup>
    if (Object.keys(filled).length === 0) return
    setGroups((current) => current.map((group) => (group.include ? { ...group, ...filled } : group)))
  }

  function toggleFile(groupId: string, fileKey: string) {
    setGroups((current) =>
      current.map((group) =>
        group.id === groupId
          ? {
              ...group,
              files: group.files.map((file) =>
                file.key === fileKey ? { ...file, include: !file.include } : file,
              ),
            }
          : group,
      ),
    )
  }

  async function handleImport() {
    const ready = groups.filter((group) => group.include && group.files.some((file) => file.include))
    const materials: ExtractedMaterial[] = ready.flatMap((group) =>
      group.files
        .filter((file) => file.include)
        .map((file) => ({
          ...file.material,
          // Stored subject name for unfiled materials — a data value, not a UI text.
          subject: group.subject.trim() || 'Nezařazeno',
          grade: group.grade.trim() || null,
          topic: group.topic.trim() || file.material.topic,
        })),
    )
    if (materials.length === 0) return

    setPhase('uploading')
    setError(null)
    try {
      const result = await uploadMaterials(materials, {
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setSummary(result)
      // Where to continue: the first three topics are enough, more links would be a list.
      const found = await Promise.all(
        ready
          .slice(0, 3)
          .map((group) =>
            lookupDestination(group.subject.trim() || 'Nezařazeno', group.grade.trim(), group.topic.trim()).catch(
              () => null,
            ),
          ),
      )
      // With bulk filing the groups meet in one topic — one link is enough.
      const unique = new Map(
        found.filter((item): item is ImportDestination => item !== null).map((item) => [item.topicId, item]),
      )
      setDestinations([...unique.values()])
      setPhase('done')
      router.refresh()
    } catch (uploadError) {
      setError(errorMessage(uploadError, t('library:importClient.saveFailed')))
      setPhase('preview')
    }
  }

  const busy = phase === 'extracting' || phase === 'uploading'

  // Closing or reloading the page mid-read or mid-save used to lose the
  // import in progress without a warning.
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  return (
    <div className="space-y-4">
      <Card
        className={cn(
          'items-center p-8 text-center transition-colors',
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
          if (busy) return
          void filesFromDrop(event.dataTransfer).then(handleEntries)
        }}
      >
        <input
          ref={folderRef}
          type="file"
          multiple
          className="hidden"
          data-testid="import-folder"
          // @ts-expect-error non-standard attribute for picking a whole folder
          webkitdirectory=""
          onChange={(event) => {
            void handleEntries(entriesFromInput(event.target.files))
            // Without the reset, picking the same folder again wouldn't fire `change`.
            event.target.value = ''
          }}
        />
        <input
          ref={filesRef}
          type="file"
          multiple
          className="hidden"
          data-testid="import-files"
          onChange={(event) => {
            void handleEntries(entriesFromInput(event.target.files))
            event.target.value = ''
          }}
        />

        <FolderUp className="size-8 text-fg-muted" aria-hidden />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button size="lg" disabled={busy} onClick={() => folderRef.current?.click()}>
            {t('library:import.pickFolder')}
          </Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={() => filesRef.current?.click()}>
            <FileUp className="size-4" aria-hidden />
            {t('library:import.pickFiles')}
          </Button>
        </div>
        <p className="text-sm text-fg-soft" data-testid="import-drop-hint">
          {t('library:import.dropHint')}
        </p>
        <p className="max-w-md text-sm text-fg-muted">{t('library:import.supported')}</p>

        {busy ? (
          <div className="w-full max-w-md space-y-2">
            <p className="text-sm text-fg-soft">
              <Loader2 className="mr-2 inline size-4 animate-spin" />
              {phase === 'extracting' ? t('library:import.reading') : t('library:import.saving')}: {progress.done} /{' '}
              {progress.total}
            </p>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
          </div>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </Card>

      {summary ? (
        <Card className="border-brand bg-brand-bg p-5" data-testid="import-summary" data-count={summary.imported}>
          <p className="text-sm text-fg-soft">
            {t('library:import.imported', { materials: t('library:count.materials', { count: summary.imported }) })}
            {summary.duplicates > 0 ? t('library:import.alreadyInLibrary', { duplicates: summary.duplicates }) : ''}.
          </p>
          <p className="mt-1 text-sm text-fg-muted">{t('library:import.whereNext')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {destinations.map((destination) => (
              <Button
                key={destination.topicId}
                size="sm"
                onClick={() => router.push(`/topics/${destination.topicId}`)}
              >
                {t('library:import.topicLink', { name: destination.topicName })}
              </Button>
            ))}
            {[...new Map(destinations.filter((d) => d.gradeId).map((d) => [d.gradeId, d])).values()].map(
              (destination) => (
                <Button
                  key={destination.gradeId}
                  size="sm"
                  variant="outline"
                  onClick={() => router.push(`/tridy/${destination.gradeId}`)}
                >
                  {t('library:import.gradeLink', { name: destination.gradeName || t('library:import.noGrade') })}
                </Button>
              ),
            )}
            <Button size="sm" variant="ghost" onClick={() => router.push('/?vse=1')}>
              {t('library:import.allClasses')}
            </Button>
          </div>
        </Card>
      ) : null}

      {groups.length > 0 && phase !== 'done' ? (
        <>
          <Card className="sticky top-2 z-10 flex-row flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <h2 className="text-sm font-semibold text-fg">
                {t('library:import.previewTitle', {
                  topics: t('library:count.topics', { count: groups.length }),
                  files: t('library:import.files', { count: selected.length }),
                })}
              </h2>
              <p className="mt-1 text-sm text-fg-muted">{t('library:import.previewHint')}</p>
            </div>
            <Button disabled={busy || selected.length === 0} onClick={() => void handleImport()}>
              {t('library:import.importButton', { n: selected.length })}
            </Button>
          </Card>

          {groups.length > 1 ? (
            <BulkAssign
              subjects={allSubjects}
              gradeHints={gradeHints}
              disabled={busy}
              onApply={updateAll}
            />
          ) : null}

          {groups.map((group) => {
            const near = nearDuplicateSubject(group.subject)
            const chosen = group.files.filter((file) => file.include).length
            return (
              <Card
                key={group.id}
                className={cn('gap-4 p-5', !group.include && 'opacity-55')}
                data-testid="import-group"
              >
                <div className="flex flex-wrap items-end gap-3">
                  <Field
                    label={t('library:import.subject')}
                    value={group.subject}
                    listId={`subjects-${group.id}`}
                    options={allSubjects}
                    placeholder={t('library:import.subjectPlaceholder')}
                    invalid={!group.subject.trim()}
                    disabled={!group.include}
                    onChange={(value) => update(group.id, { subject: value })}
                  />
                  <Field
                    label={t('library:import.grade')}
                    value={group.grade}
                    listId={`grades-${group.id}`}
                    options={gradeHints(group.subject)}
                    placeholder={t('library:import.noGrade')}
                    disabled={!group.include}
                    onChange={(value) => update(group.id, { grade: value })}
                  />
                  <Field
                    label={t('library:import.topic')}
                    value={group.topic}
                    className="min-w-56 flex-1"
                    disabled={!group.include}
                    onChange={(value) => update(group.id, { topic: value })}
                  />
                  <Button
                    size="sm"
                    variant={group.include ? 'outline' : 'default'}
                    onClick={() => update(group.id, { include: !group.include })}
                  >
                    {group.include ? (
                      t('library:import.excludeTopic')
                    ) : (
                      <>
                        <Undo2 className="size-4" aria-hidden />
                        {t('library:import.restoreTopic')}
                      </>
                    )}
                  </Button>
                </div>

                {!group.subject.trim() && group.include ? (
                  <p className="text-sm text-draft-fg" data-testid="import-subject-missing">
                    {t('library:import.subjectMissing')}
                  </p>
                ) : null}
                {near ? (
                  <p className="text-sm text-draft-fg">{t('library:import.nearDuplicateSubject', { name: near })}</p>
                ) : null}

                <ul className="divide-y divide-line-soft text-sm">
                  {group.files.map((file) => (
                    <li key={file.key} className="flex flex-wrap items-center gap-2 py-1.5">
                      <Checkbox
                        checked={file.include}
                        disabled={!group.include}
                        aria-label={t('library:import.includeFile', { name: file.material.fileName })}
                        onCheckedChange={() => toggleFile(group.id, file.key)}
                      />
                      <span className={cn('font-medium text-fg-soft', !file.include && 'line-through')}>
                        {file.material.fileName}
                      </span>
                      {/* For a standalone file the path is just its name — no point writing it twice. */}
                      {file.material.relativePath !== file.material.fileName ? (
                        <span className="text-fg-muted">{file.material.relativePath}</span>
                      ) : null}
                      <span className="ml-auto text-fg-muted">
                        {t('library:materialRow.chars', { chars: file.material.text.length.toLocaleString('cs') })}
                      </span>
                      {file.material.needsOcr ? (
                        <Badge className="bg-draft-bg text-draft-fg">{t('library:import.needsOcr')}</Badge>
                      ) : file.material.text.length < LOW_TEXT ? (
                        <Badge className="bg-draft-bg text-draft-fg" data-testid="low-text-badge">
                          {t('library:import.lowText')}
                        </Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {chosen === 0 && group.include ? (
                  <p className="text-sm text-fg-muted">{t('library:import.nothingSelected')}</p>
                ) : null}
              </Card>
            )
          })}
        </>
      ) : null}

      {failed.length > 0 ? (
        <IssueList title={t('library:import.failedTitle', { n: failed.length })} items={failed} kind="danger" testId="failed-files" />
      ) : null}
      {skipped.length > 0 ? (
        <IssueList title={t('library:import.skippedTitle', { n: skipped.length })} items={skipped} kind="neutral" testId="skipped-files" />
      ) : null}
    </div>
  )
}

/** Turns extracted materials into preview topics. */
function toPreview(materials: ExtractedMaterial[]): PreviewGroup[] {
  const keyed = materials.map((material, index) => ({ ...material, key: `file-${index}` }))
  return groupForImport(keyed).map((group) => ({
    id: group.id,
    subject: group.subject,
    grade: group.grade,
    topic: group.topic,
    include: true,
    files: group.files.map((file) => ({ key: file.key, material: file, include: true })),
  }))
}

/**
 * Filing for all topics of the preview at once — with a pile of loose files the
 * subject and grade would otherwise be typed for each topic separately.
 */
function BulkAssign({
  subjects,
  gradeHints,
  disabled,
  onApply,
}: {
  subjects: string[]
  gradeHints: (subject: string) => string[]
  disabled?: boolean
  onApply: (change: { subject: string; grade: string; topic: string }) => void
}) {
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [topic, setTopic] = useState('')
  const empty = !subject.trim() && !grade.trim() && !topic.trim()

  return (
    <Card className="gap-3 p-5" data-testid="import-bulk">
      <div>
        <h2 className="text-sm font-semibold text-fg">{t('library:import.bulk.title')}</h2>
        <p className="mt-1 text-sm text-fg-muted">{t('library:import.bulk.hint')}</p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          onApply({ subject, grade, topic })
        }}
      >
        <Field
          label={t('library:import.subject')}
          value={subject}
          listId="bulk-subjects"
          options={subjects}
          placeholder={t('library:import.bulk.unchanged')}
          disabled={disabled}
          onChange={setSubject}
        />
        <Field
          label={t('library:import.grade')}
          value={grade}
          listId="bulk-grades"
          options={gradeHints(subject)}
          placeholder={t('library:import.bulk.unchanged')}
          disabled={disabled}
          onChange={setGrade}
        />
        <Field
          label={t('library:import.topic')}
          value={topic}
          className="min-w-56 flex-1"
          placeholder={t('library:import.bulk.unchanged')}
          disabled={disabled}
          onChange={setTopic}
        />
        <Button type="submit" variant="outline" disabled={disabled || empty}>
          {t('library:import.bulk.apply')}
        </Button>
      </form>
    </Card>
  )
}

/** Editable filing field with suggestions from the library. */
function Field({
  label,
  value,
  onChange,
  options,
  listId,
  placeholder,
  invalid,
  disabled,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options?: string[]
  listId?: string
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <label className={cn('block min-w-44', className)}>
      <span className="ui-label block pb-1">{label}</span>
      <Input
        value={value}
        list={listId}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        className={cn(invalid && 'border-draft-fg')}
        onChange={(event) => onChange(event.target.value)}
      />
      {listId && options ? (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
    </label>
  )
}
