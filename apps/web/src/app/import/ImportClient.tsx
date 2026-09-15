'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ExtractedMaterial } from '@testmaker/core/schema'
import { Loader2 } from 'lucide-react'
import { Badge, Button, Card } from '@testmaker/ui'
import { extractAll, triageFiles, uploadMaterials, type FileEntry } from '@/lib/importClient'

type Phase = 'idle' | 'extracting' | 'ready' | 'uploading' | 'done'

interface Failure {
  relativePath: string
  reason: string
}

const SKIP_LABELS: Record<string, string> = {
  skryty: 'skrytý soubor',
  docasny: 'dočasný soubor',
  'systemova-slozka': 'systémová složka',
  obrazek: 'obrázek (zatím nepodporován)',
  nepodporovany: 'nepodporovaná přípona',
  'stary-format': 'starý formát – převeď na .docx / .odp',
}

export function ImportClient() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [materials, setMaterials] = useState<ExtractedMaterial[]>([])
  const [skipped, setSkipped] = useState<Failure[]>([])
  const [failed, setFailed] = useState<Failure[]>([])
  const [summary, setSummary] = useState<{ imported: number; duplicates: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const map = new Map<string, number>()
    for (const material of materials) {
      const key = [material.subject, material.grade].filter(Boolean).join(' · ') || material.subject
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'cs'))
  }, [materials])

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    setError(null)
    setSummary(null)
    setMaterials([])
    setFailed([])

    const { accepted, skipped: skippedFiles } = triageFiles(fileList)
    setSkipped(skippedFiles.map((s) => ({ ...s, reason: SKIP_LABELS[s.reason] ?? s.reason })))

    if (accepted.length === 0) {
      setPhase('ready')
      return
    }

    setPhase('extracting')
    setProgress({ done: 0, total: accepted.length })

    const extracted: ExtractedMaterial[] = []
    const failures: Failure[] = []
    let done = 0

    try {
      await extractAll(accepted as FileEntry[], (result) => {
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

    setMaterials(extracted)
    setFailed(failures)
    setPhase('ready')
  }

  async function handleUpload() {
    setPhase('uploading')
    setError(null)
    try {
      const result = await uploadMaterials(materials, (done, total) => setProgress({ done, total }))
      setSummary(result)
      setPhase('done')
      router.refresh()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : String(uploadError))
      setPhase('ready')
    }
  }

  const busy = phase === 'extracting' || phase === 'uploading'

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          // @ts-expect-error nestandardní atribut pro výběr celé složky
          webkitdirectory=""
          onChange={(event) => void handleFiles(event.target.files)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={busy} onClick={() => inputRef.current?.click()}>
            Vybrat složku
          </Button>
          <span className="text-sm text-fg-muted">
            Podporováno: PDF, ODP, ODT, ODS, DOCX, HTML, TXT. Obrázky a staré .doc/.ppt se přeskočí.
          </span>
        </div>

        {busy ? (
          <div className="mt-4 flex items-center gap-3">
            <Loader2 className="size-4 animate-spin" />
            <span className="text-sm text-fg-soft">
              {phase === 'extracting' ? 'Čtu soubory' : 'Ukládám'}: {progress.done} / {progress.total}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded bg-surface-muted">
              <div
                className="h-full bg-brand transition-all"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
              />
            </div>
          </div>
        ) : null}

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </Card>

      {summary ? (
        <Card className="border-brand bg-brand-bg p-5">
          <p className="text-sm text-fg-soft">
            Naimportováno {summary.imported} materiálů
            {summary.duplicates > 0 ? `, ${summary.duplicates} už v knihovně bylo` : ''}.
          </p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => router.push('/')}>
              Přejít na přehled
            </Button>
          </div>
        </Card>
      ) : null}

      {materials.length > 0 && phase !== 'done' ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-fg">
                Připraveno k importu: {materials.length}
              </h2>
              <p className="mt-1 text-sm text-fg-muted">
                {grouped.map(([key, value]) => `${key} (${value})`).join(', ')}
              </p>
            </div>
            <Button disabled={busy} onClick={() => void handleUpload()}>
              Naimportovat
            </Button>
          </div>

          <ul className="mt-4 max-h-72 divide-y divide-line-soft overflow-y-auto text-sm">
            {materials.map((material) => (
              <li key={material.contentHash} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="font-medium text-fg-soft">{material.topic}</span>
                <span className="text-fg-muted">{material.relativePath}</span>
                <span className="ml-auto text-fg-muted">{material.text.length.toLocaleString('cs')} znaků</span>
                {material.needsOcr ? <Badge className="bg-draft-bg text-draft-fg">skoro bez textu</Badge> : null}
              </li>
            ))}
          </ul>
        </Card>
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

function IssueList({
  title,
  items,
  kind,
}: {
  title: string
  items: Failure[]
  kind: 'danger' | 'neutral'
}) {
  return (
    <Card className="p-5">
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-fg-soft">{title}</summary>
        <ul className="mt-3 max-h-60 space-y-1 overflow-y-auto text-sm">
          {items.map((item) => (
            <li key={item.relativePath} className="flex flex-wrap gap-2">
              <span className="text-fg-soft">{item.relativePath}</span>
              <span className={kind === 'danger' ? 'text-danger' : 'text-fg-muted'}>{item.reason}</span>
            </li>
          ))}
        </ul>
      </details>
    </Card>
  )
}
