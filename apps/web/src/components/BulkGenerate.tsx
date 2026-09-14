'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Checkbox, Spinner } from '@testmaker/ui'
import {
  AiUnavailable,
  DEFAULT_SETTINGS,
  GenerateSettingsForm,
  type GenerateSettings,
} from '@/components/GenerateDialog'
import { drainQueue } from '@/lib/generateClient'

export interface BulkScope {
  label: string
  subjectId?: string
  gradeId?: string
}

/**
 * Hromadné generování pro celý předmět nebo ročník. Fronta se ukládá do databáze
 * a zpracovává se po jedné úloze, aby se každý běh vešel do limitu funkce.
 */
export function BulkGenerate({
  scopes,
  ai,
}: {
  scopes: BulkScope[]
  ai: { configured: boolean; provider: string; model: string }
}) {
  const router = useRouter()
  const [settings, setSettings] = useState<GenerateSettings>(DEFAULT_SETTINGS)
  const [skipWithQuestions, setSkipWithQuestions] = useState(true)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const stopRef = useRef(false)

  if (!ai.configured) return <AiUnavailable provider={ai.provider} />

  async function start(scope: BulkScope) {
    setErrors([])
    setRunning(true)
    stopRef.current = false
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...scope, ...settings, skipWithQuestions }),
      })
      const queued = (await response.json()) as { enqueued: number; skipped: number }
      if (queued.enqueued === 0) {
        setStatus(`Není co generovat (přeskočeno ${queued.skipped} skupin, které už otázky mají).`)
        setRunning(false)
        return
      }

      let created = 0
      let done = 0
      setStatus(`Ve frontě ${queued.enqueued} skupin.`)

      await drainQueue(
        (step) => {
          done += 1
          created += step.created ?? 0
          if (step.error) setErrors((current) => [...current, step.error as string])
          setStatus(`Hotovo ${done} skupin, vytvořeno ${created} otázek, zbývá ${step.remaining}.`)
        },
        () => stopRef.current,
      )

      setStatus(`Dokončeno: ${created} otázek z ${done} skupin.`)
      router.refresh()
    } catch (error) {
      setErrors((current) => [...current, error instanceof Error ? error.message : String(error)])
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold text-ink-900">Hromadné generování</h2>
      <p className="mt-1 text-sm text-ink-500">
        Projde všechny skupiny materiálů ve zvoleném rozsahu. Běží po jedné skupině, průběh se
        průběžně ukládá, takže se dá kdykoli zastavit a později dokončit.
      </p>

      <div className="mt-3">
        <GenerateSettingsForm value={settings} onChange={setSettings} disabled={running} />
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-ink-700">
        <Checkbox
          checked={skipWithQuestions}
          disabled={running}
          onChange={() => setSkipWithQuestions(!skipWithQuestions)}
        />
        Přeskočit skupiny, které už otázky mají
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {scopes.map((scope) => (
          <Button
            key={scope.label}
            size="sm"
            variant="primary"
            disabled={running}
            onClick={() => void start(scope)}
          >
            {scope.label}
          </Button>
        ))}
        {running ? (
          <>
            <Spinner />
            <Button size="sm" variant="danger" onClick={() => (stopRef.current = true)}>
              Zastavit
            </Button>
          </>
        ) : null}
      </div>

      {status ? <p className="mt-3 text-sm text-ink-700">{status}</p> : null}
      {errors.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-sm text-danger-600">
          {errors.slice(0, 5).map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}
