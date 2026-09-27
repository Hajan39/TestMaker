'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ExtractedMaterial } from '@testmaker/core/schema'
import { groupForImport } from '@testmaker/core/extract'
import { FileUp, FolderUp, Loader2, Undo2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  cn,
  Input,
  Progress,
  plural,
  pocet,
  MATERIALY,
  TEMATA,
} from '@testmaker/ui'
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
import { IssueList, SKIP_LABELS } from '@/components/importIssues'

type Phase = 'idle' | 'extracting' | 'preview' | 'uploading' | 'done'

interface Failure {
  relativePath: string
  reason: string
}

/** Předměty a jejich ročníky, jak už v knihovně jsou — pro našeptávání. */
export interface LibraryHint {
  subject: string
  grades: string[]
}

/** Jeden soubor v náhledu; `include` říká, jestli se má poslat. */
interface PreviewFile {
  key: string
  material: ExtractedMaterial
  include: boolean
}

/** Téma v náhledu — zařazení se dá přepsat, celé téma vynechat. */
interface PreviewGroup {
  id: string
  subject: string
  grade: string
  topic: string
  include: boolean
  files: PreviewFile[]
}

/** Pod tímhle počtem znaků na otázky text nejspíš nestačí. */
const LOW_TEXT = 400

/** Bez diakritiky a velikosti písmen — aby „PŘÍRODOPIS“ našlo „Přírodopis“. */
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

  /** Ročníky zvoleného předmětu; u neznámého předmětu všechny, co v knihovně jsou. */
  function gradeHints(subject: string): string[] {
    const own = library.find((hint) => fold(hint.subject) === fold(subject))?.grades.filter(Boolean)
    return own && own.length > 0 ? own : allGrades
  }

  /** Předmět, který se od napsaného liší jen velikostí písmen nebo diakritikou. */
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
    setSkipped(skippedFiles.map((item) => ({ ...item, reason: SKIP_LABELS[item.reason] ?? item.reason })))

    if (accepted.length === 0) {
      setPhase('preview')
      return
    }

    setPhase('extracting')
    setProgress({ done: 0, total: accepted.length })

    const extracted: ExtractedMaterial[] = []
    const failures: Failure[] = []
    let done = 0
    // Extrakce doběhne, ale soubor nemá žádný text (`status: 'skipped'` z
    // `processFile`) — patří mezi přeskočené, jinak beze stopy zmizí.
    const emptySkips: Failure[] = []

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
      setError(workerError instanceof Error ? workerError.message : String(workerError))
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
      // Kam pokračovat: první tři témata stačí, víc odkazů by byl seznam.
      const found = await Promise.all(
        ready
          .slice(0, 3)
          .map((group) =>
            lookupDestination(group.subject.trim() || 'Nezařazeno', group.grade.trim(), group.topic.trim()).catch(
              () => null,
            ),
          ),
      )
      setDestinations(found.filter((item): item is ImportDestination => item !== null))
      setPhase('done')
      router.refresh()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError))
      setPhase('preview')
    }
  }

  const busy = phase === 'extracting' || phase === 'uploading'

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
          // @ts-expect-error nestandardní atribut pro výběr celé složky
          webkitdirectory=""
          onChange={(event) => void handleEntries(entriesFromInput(event.target.files))}
        />
        <input
          ref={filesRef}
          type="file"
          multiple
          className="hidden"
          data-testid="import-files"
          onChange={(event) => void handleEntries(entriesFromInput(event.target.files))}
        />

        <FolderUp className="size-8 text-fg-muted" aria-hidden />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button size="lg" disabled={busy} onClick={() => folderRef.current?.click()}>
            Vybrat složku
          </Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={() => filesRef.current?.click()}>
            <FileUp className="size-4" aria-hidden />
            Vybrat soubory
          </Button>
        </div>
        <p className="text-sm text-fg-soft">
          Nebo sem soubory i celé složky přetáhni myší.
        </p>
        <p className="max-w-md text-sm text-fg-muted">
          Podporováno: PDF, ODP, ODT, ODS, DOCX, HTML, TXT. Obrázky a staré .doc/.ppt se přeskočí.
          Nic se neuloží dřív, než si zařazení v náhledu projdeš.
        </p>

        {busy ? (
          <div className="w-full max-w-md space-y-2">
            <p className="text-sm text-fg-soft">
              <Loader2 className="mr-2 inline size-4 animate-spin" />
              {phase === 'extracting' ? 'Čtu soubory' : 'Ukládám'}: {progress.done} / {progress.total}
            </p>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
          </div>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </Card>

      {summary ? (
        <Card className="border-brand bg-brand-bg p-5">
          <p className="text-sm text-fg-soft">
            Naimportováno {pocet(summary.imported, MATERIALY)}
            {summary.duplicates > 0 ? `, ${summary.duplicates} už v knihovně bylo` : ''}.
          </p>
          <p className="mt-1 text-sm text-fg-muted">Kam chceš pokračovat?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {destinations.map((destination) => (
              <Button
                key={destination.topicId}
                size="sm"
                onClick={() => router.push(`/topics/${destination.topicId}`)}
              >
                Téma {destination.topicName}
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
                  Ročník {destination.gradeName || 'bez ročníku'}
                </Button>
              ),
            )}
            <Button size="sm" variant="ghost" onClick={() => router.push('/')}>
              Přehled knihovny
            </Button>
          </div>
        </Card>
      ) : null}

      {groups.length > 0 && phase !== 'done' ? (
        <>
          <Card className="sticky top-2 z-10 flex-row flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <h2 className="text-sm font-semibold text-fg">
                Náhled importu: {pocet(groups.length, TEMATA)}, {selected.length}{' '}
                {plural(selected.length, 'soubor', 'soubory', 'souborů')}
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                Zkontroluj zařazení. Co se uloží, rozhoduje tlačítko níž — teď ještě v knihovně nic není.
              </p>
            </div>
            <Button disabled={busy || selected.length === 0} onClick={() => void handleImport()}>
              Importovat ({selected.length})
            </Button>
          </Card>

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
                    label="Předmět"
                    value={group.subject}
                    listId={`predmety-${group.id}`}
                    options={allSubjects}
                    placeholder="Doplň předmět"
                    invalid={!group.subject.trim()}
                    disabled={!group.include}
                    onChange={(value) => update(group.id, { subject: value })}
                  />
                  <Field
                    label="Ročník"
                    value={group.grade}
                    listId={`rocniky-${group.id}`}
                    options={gradeHints(group.subject)}
                    placeholder="bez ročníku"
                    disabled={!group.include}
                    onChange={(value) => update(group.id, { grade: value })}
                  />
                  <Field
                    label="Téma"
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
                      'Vynechat téma'
                    ) : (
                      <>
                        <Undo2 className="size-4" aria-hidden />
                        Vrátit zpět
                      </>
                    )}
                  </Button>
                </div>

                {!group.subject.trim() && group.include ? (
                  <p className="text-sm text-draft-fg">
                    Předmět z cesty vyčíst nešel. Doplň ho, jinak téma skončí v „Nezařazeno“.
                  </p>
                ) : null}
                {near ? (
                  <p className="text-sm text-draft-fg">
                    V knihovně už je „{near}“. Napiš to stejně, ať nevzniknou dva předměty.
                  </p>
                ) : null}

                <ul className="divide-y divide-line-soft text-sm">
                  {group.files.map((file) => (
                    <li key={file.key} className="flex flex-wrap items-center gap-2 py-1.5">
                      <Checkbox
                        checked={file.include}
                        disabled={!group.include}
                        aria-label={`Zahrnout ${file.material.fileName}`}
                        onCheckedChange={() => toggleFile(group.id, file.key)}
                      />
                      <span className={cn('font-medium text-fg-soft', !file.include && 'line-through')}>
                        {file.material.fileName}
                      </span>
                      {/* U samostatného souboru je cesta jen jeho název — psát ho dvakrát nemá smysl. */}
                      {file.material.relativePath !== file.material.fileName ? (
                        <span className="text-fg-muted">{file.material.relativePath}</span>
                      ) : null}
                      <span className="ml-auto text-fg-muted">
                        {file.material.text.length.toLocaleString('cs')} znaků
                      </span>
                      {file.material.needsOcr ? (
                        <Badge className="bg-draft-bg text-draft-fg">skoro bez textu – nejspíš sken</Badge>
                      ) : file.material.text.length < LOW_TEXT ? (
                        <Badge className="bg-draft-bg text-draft-fg">málo textu</Badge>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {chosen === 0 && group.include ? (
                  <p className="text-sm text-fg-muted">Z tématu se neuloží nic — všechny řádky jsou vynechané.</p>
                ) : null}
              </Card>
            )
          })}
        </>
      ) : null}

      {failed.length > 0 ? (
        <IssueList title={`Nepodařilo se přečíst (${failed.length})`} items={failed} kind="danger" />
      ) : null}
      {skipped.length > 0 ? (
        <IssueList title={`Přeskočeno (${skipped.length})`} items={skipped} kind="neutral" />
      ) : null}
    </div>
  )
}

/** Z extrahovaných materiálů udělá témata náhledu. */
function toPreview(materials: ExtractedMaterial[]): PreviewGroup[] {
  const keyed = materials.map((material, index) => ({ ...material, key: `soubor-${index}` }))
  return groupForImport(keyed).map((group) => ({
    id: group.id,
    subject: group.subject,
    grade: group.grade,
    topic: group.topic,
    include: true,
    files: group.files.map((file) => ({ key: file.key, material: file, include: true })),
  }))
}

/** Editovatelné políčko zařazení s našeptáváním z knihovny. */
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
