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
import { t } from '@testmaker/core/i18n'
import {
  DEFAULT_SETTINGS,
  GenerateSettingsForm,
  type GenerateSettings,
} from '@/components/GenerateDialog'
import { announceGeneration } from '@/components/GenerationStatus'
import { drainQueue } from '@/lib/generateClient'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import { runSummary } from '@/lib/queueSummary'
import { useCanEdit } from '@/components/Permissions'

export interface BulkScope {
  label: string
  subjectId?: string
  gradeId?: string
}

/**
 * Bulk generation for a whole subject or grade. The queue is stored in the
 * database and processed one job at a time so each run fits the function limit.
 */
export function BulkGenerate({
  scopes,
  ai,
}: {
  scopes: BulkScope[]
  ai: { configured: boolean; provider: string; model: string }
}) {
  // Only those who may edit content may generate.
  const canEdit = useCanEdit()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<GenerateSettings>(DEFAULT_SETTINGS)
  const [skipWithQuestions, setSkipWithQuestions] = useState(true)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const stopRef = useRef(false)

  // Guard after the hooks: hook call order must be the same on every render.
  if (!canEdit) return null

  async function start(scope: BulkScope) {
    setErrors([])
    setRunning(true)
    // Building the queue over a whole subject takes a few seconds. Without this
    // line the area stayed empty after the click until the first count arrived,
    // and it looked as if the click didn't register.
    const preparing = t('generation:bulkGenerate.preparing')
    setStatus(preparing)
    stopRef.current = false
    try {
      // A server rejection (e.g. an expired session) ends in the `catch` below —
      // previously the count was read from the error response, reporting "Ve frontě undefined témat".
      const queued = await requestJson<{ enqueued: number; skipped: number }>(
        '/api/jobs',
        jsonBody('POST', { ...scope, ...settings, skipWithQuestions }),
        t('generation:bulkGenerate.enqueueFailed'),
      )
      const enqueued = queued.enqueued ?? 0
      const skipped = queued.skipped ?? 0
      if (enqueued === 0) {
        setStatus(
          skipped > 0
            ? t('generation:bulkGenerate.allHaveQuestions', { topics: t('library:count.topics', { count: skipped }) })
            : t('generation:bulkGenerate.noMaterials'),
        )
        setRunning(false)
        return
      }

      let created = 0
      let done = 0
      let failed = 0
      setStatus(t('generation:bulkGenerate.enqueued', { topics: t('library:count.topics', { count: enqueued }) }))
      // So the toolbar knows about the work in progress even when the panel is closed.
      announceGeneration()

      await drainQueue(
        (step) => {
          // The last request on an empty queue processes no topic.
          if (!step.processed) return
          done += 1
          created += step.created ?? 0
          if (step.error) {
            failed += 1
            setErrors((current) => [...current, step.error as string])
          }
          // One counting direction as in the rest of the app: how many remain.
          setStatus(
            t('generation:bulkGenerate.progress', {
              topics: t('library:count.topics', { count: step.remaining }),
              questions: t('library:count.questions', { count: created }),
            }),
          )
        },
        () => stopRef.current,
      )

      // The same sentence as on the generation overview, from the same function —
      // so one run isn't reported two different ways in two places.
      setStatus(runSummary({ processed: done, errors: failed, questions: created }).text)
      router.refresh()
    } catch (error) {
      setStatus((current) => (current === preparing ? null : current))
      setErrors((current) => [...current, errorMessage(error, t('generation:bulkGenerate.stopped'))])
    } finally {
      setRunning(false)
    }
  }

  // Without configured AI, bulk generation isn't offered at all.
  if (!ai.configured) return null

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {/* The button stays active while running — otherwise a closed panel
            couldn't be reopened to stop the generation. */}
        <Button size="sm" variant="outline">
          {running ? t('generation:bulkGenerate.triggerRunning') : t('generation:bulkGenerate.title')}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t('generation:bulkGenerate.title')}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-4">
          <p className="text-sm text-fg-muted">{t('generation:bulkGenerate.intro')}</p>

              <p className="text-sm text-fg-muted">
                {t('generation:bulkGenerate.overviewBefore')}{' '}
                <Link href="/generovani" className="text-brand underline underline-offset-2">
                  {t('generation:bulkGenerate.overviewLink')}
                </Link>
                {' '}{t('generation:bulkGenerate.overviewAfter')}
              </p>

              <GenerateSettingsForm value={settings} onChange={setSettings} disabled={running} />

              <label className="flex items-center gap-2 text-sm text-fg-soft">
                <Checkbox
                  checked={skipWithQuestions}
                  disabled={running}
                  onCheckedChange={() => setSkipWithQuestions(!skipWithQuestions)}
                />
                {t('generation:bulkGenerate.skipWithQuestions')}
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
                      {t('generation:bulkGenerate.stop')}
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
