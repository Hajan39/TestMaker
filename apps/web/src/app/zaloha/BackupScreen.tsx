'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BusyButton, Button, Card, StatRow, toast } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import {
  restoreFromBackup,
  countsInBackup,
  tableLabel,
  parseBackup,
  tableCount,
  type Progress,
  type Backup,
} from '@/lib/backupClient'
import { errorMessage, fetchOrOffline, readJson, responseError } from '@/lib/requestJson'
import { formatDateTime } from '@testmaker/core/dates'

/** What shows in the count row above the page; the rest is in the cards. */
const OVERVIEW = ['subjects', 'topics', 'materials', 'questions', 'tests'] as const

/**
 * Library backup: download the whole library into one file and upload it back.
 *
 * Restoring deliberately takes two clicks: first the file is only read and
 * its contents listed, and only then is anything written. Uploading someone
 * else's or a half-year-old file by mistake is the only error possible here.
 */
export function BackupScreen({ counts }: { counts: Record<string, number> }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [backup, setBackup] = useState<Backup | null>(null)
  const [backupFileName, setBackupFileName] = useState<string>('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [result, setResult] = useState<Record<string, number> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  // Restoring goes in many batches; a closed tab would cut it off halfway.
  useEffect(() => {
    if (!restoring) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [restoring])

  /**
   * Download via fetch, not a plain link: with an expired session or a server
   * error a link would save the error message as the "backup" and nobody
   * would notice until they needed it.
   */
  async function download() {
    const failure = t('backup:download.failed')
    setDownloading(true)
    try {
      const response = await fetchOrOffline('/api/export', undefined, failure)
      if (!response.ok) throw responseError(response, await readJson(response), failure)
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error(`${failure} ${t('backup:download.notAFile')}`)
      }
      // A connection torn mid-download is reported by `blob()` as a TypeError — `errorMessage` catches that too.
      const blob = await response.blob()
      const name =
        /filename="?([^";]+)"?/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'testmaker-zaloha.json'
      const url = URL.createObjectURL(blob)
      const reference = document.createElement('a')
      reference.href = url
      reference.download = name
      reference.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(errorMessage(error, failure))
    } finally {
      setDownloading(false)
    }
  }

  async function chooseFile(file: File | null) {
    setError(null)
    setResult(null)
    setBackup(null)
    if (!file) return
    try {
      const parsed = parseBackup(await file.text())
      setBackup(parsed)
      setBackupFileName(file.name)
    } catch (error) {
      setError(errorMessage(error, t('backup:restore.readFailed')))
    }
  }

  async function restore() {
    if (!backup) return
    setRestoring(true)
    setError(null)
    let partial = false
    try {
      const restored = await restoreFromBackup(backup, (update) => {
        if (update.done > 0) partial = true
        setProgress(update)
      })
      setResult(restored)
      setBackup(null)
      setProgress(null)
      // The counts above the page must match after a restore; the server reloads them.
      router.refresh()
    } catch (error) {
      const message = errorMessage(error, t('backup:errors.restoreFailed'))
      // Merging is by id (`on conflict do update`), so a repeated run duplicates nothing.
      setError(partial ? `${message} ${t('backup:restore.partial')}` : message)
      // Whatever got loaded should also show in the counts above the page.
      if (partial) router.refresh()
    } finally {
      setRestoring(false)
    }
  }

  const inBackup = backup ? countsInBackup(backup) : null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="ui-page-title">{t('backup:title')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-fg-soft">{t('backup:intro')}</p>
      </div>

      <StatRow
        items={OVERVIEW.map((table) => ({
          value: counts[table] ?? 0,
          label: tableLabel(table),
        }))}
      />

      <Card className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">{t('backup:download.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">{t('backup:download.hint')}</p>
        </div>
        <div>
          <BusyButton
            busy={downloading}
            busyLabel={t('backup:download.busy')}
            onClick={() => void download()}
            data-testid="stahnout-zalohu"
          >
            {t('backup:download.title')}
          </BusyButton>
        </div>
      </Card>

      <Card className="space-y-3 p-4">
        <div>
          <h2 className="text-sm font-semibold text-fg">{t('backup:restore.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-fg-muted">{t('backup:restore.hint')}</p>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          data-testid="zaloha-soubor"
          onChange={(event) => {
            void chooseFile(event.target.files?.[0] ?? null)
            // Without resetting, choosing the same file again (e.g. after an error) would do nothing.
            event.target.value = ''
          }}
        />
        <div>
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={restoring}>
            {t('backup:restore.chooseFile')}
          </Button>
        </div>

        {inBackup ? (
          <div className="space-y-3 rounded-[var(--radius-inner)] border border-line p-3" data-testid="zaloha-potvrzeni">
            <div>
              <p className="text-sm font-medium text-fg">
                {t('backup:restore.willLoad', { file: backupFileName })}
              </p>
              <ul className="ui-numeric mt-1 grid gap-x-6 gap-y-0.5 text-sm text-fg-soft sm:grid-cols-2">
                {Object.entries(inBackup)
                  .filter(([, count]) => count > 0)
                  .map(([table, count]) => (
                    <li key={table}>{tableCount(table, count)}</li>
                  ))}
              </ul>
              {backup?.vytvoreno ? (
                <p className="mt-2 text-xs text-fg-muted">
                  {t('backup:restore.createdAt', { date: formatDateTime(backup.vytvoreno) })}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <BusyButton busy={restoring} busyLabel={t('backup:restore.busy')} onClick={() => void restore()}>
                {t('backup:restore.action')}
              </BusyButton>
              <Button variant="ghost" onClick={() => setBackup(null)} disabled={restoring}>
                {t('common:actions.cancel')}
              </Button>
            </div>
            {progress ? (
              <p className="ui-numeric text-sm text-fg-muted" aria-live="polite">
                {t('backup:restore.progress', { table: tableLabel(progress.table), done: progress.done, total: progress.total })}
              </p>
            ) : null}
          </div>
        ) : null}

        {result ? (
          <div className="rounded-[var(--radius-inner)] border border-line p-3" data-testid="zaloha-hotovo">
            <p className="text-sm font-medium text-fg">{t('backup:restore.done')}</p>
            <ul className="ui-numeric mt-1 grid gap-x-6 gap-y-0.5 text-sm text-fg-soft sm:grid-cols-2">
              {Object.entries(result)
                .filter(([, count]) => count > 0)
                .map(([table, count]) => (
                  <li key={table}>{tableCount(table, count)}</li>
                ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <p className="text-sm text-danger" role="alert" data-testid="zaloha-chyba">
            {error}
          </p>
        ) : null}
      </Card>
    </div>
  )
}
