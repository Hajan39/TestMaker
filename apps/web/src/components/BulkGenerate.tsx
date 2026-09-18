'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import {
  Button,
  Checkbox,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@testmaker/ui'
import {
  DEFAULT_SETTINGS,
  GenerateSettingsForm,
  type GenerateSettings,
} from '@/components/GenerateDialog'
import { announceGeneration } from '@/components/GenerationStatus'
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
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<GenerateSettings>(DEFAULT_SETTINGS)
  const [skipWithQuestions, setSkipWithQuestions] = useState(true)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const stopRef = useRef(false)

  async function start(scope: BulkScope) {
    setErrors([])
    setRunning(true)
    // Sestavení fronty přes celý předmět trvá pár vteřin. Bez tohohle řádku
    // byla plocha po kliknutí prázdná až do chvíle, kdy přišel první počet,
    // a vypadalo to, že se kliknutí nechytlo.
    setStatus('Připravuji frontu…')
    stopRef.current = false
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...scope, ...settings, skipWithQuestions }),
      })
      const queued = (await response.json()) as { enqueued: number; skipped: number }
      if (queued.enqueued === 0) {
        setStatus(`Není co generovat (přeskočeno ${queued.skipped} témat, která už otázky mají).`)
        setRunning(false)
        return
      }

      let created = 0
      let done = 0
      setStatus(`Ve frontě ${queued.enqueued} témat.`)
      // Ať se o rozdělané práci ví i v liště, když se panel zavře.
      announceGeneration()

      await drainQueue(
        (step) => {
          done += 1
          created += step.created ?? 0
          if (step.error) setErrors((current) => [...current, step.error as string])
          setStatus(`Hotovo ${done} témat, vytvořeno ${created} otázek, zbývá ${step.remaining}.`)
        },
        () => stopRef.current,
      )

      setStatus(`Dokončeno: ${created} otázek z ${done} témat.`)
      router.refresh()
    } catch (error) {
      setErrors((current) => [...current, error instanceof Error ? error.message : String(error)])
    } finally {
      setRunning(false)
    }
  }

  // Bez nakonfigurované AI se hromadné generování vůbec nenabízí.
  if (!ai.configured) return null

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline" disabled={running}>
          Hromadné generování
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Hromadné generování</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <p className="text-sm text-fg-muted">
                Projde všechna témata ve zvoleném rozsahu. Běží po jednom tématu, průběh
                se průběžně ukládá, takže se dá kdykoli zastavit a později dokončit.
              </p>

              <p className="text-sm text-fg-muted">
                Co se právě tvoří, co čeká a co se nepovedlo, je vidět v{' '}
                <Link href="/generovani" className="text-brand underline underline-offset-2">
                  přehledu generování
                </Link>
                {' '}— i po zavření tohohle panelu.
              </p>

              <GenerateSettingsForm value={settings} onChange={setSettings} disabled={running} />

              <label className="flex items-center gap-2 text-sm text-fg-soft">
                <Checkbox
                  checked={skipWithQuestions}
                  disabled={running}
                  onCheckedChange={() => setSkipWithQuestions(!skipWithQuestions)}
                />
                Přeskočit témata, která už otázky mají
              </label>

              <div className="flex flex-wrap items-center gap-2">
                {scopes.map((scope) => (
                  <Button key={scope.label} size="sm" disabled={running} onClick={() => void start(scope)}>
                    {scope.label}
                  </Button>
                ))}
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <Button size="sm" variant="destructive" onClick={() => (stopRef.current = true)}>
                      Zastavit
                    </Button>
                  </>
                ) : null}
              </div>

              {status ? <p className="text-sm text-fg-soft">{status}</p> : null}
              {errors.length > 0 ? (
                <ul className="space-y-0.5 text-sm text-danger">
                  {errors.slice(0, 5).map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
