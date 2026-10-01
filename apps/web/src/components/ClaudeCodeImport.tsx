'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, toast } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * Questions written in Claude Code (`/otazky`): download the topic's materials
 * as text and upload the finished file back. Works even without a model in the app.
 */
export function ClaudeCodeImport({ topicId }: { topicId: string }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const base = `/api/topics/${encodeURIComponent(topicId)}`

  async function upload(file: File) {
    setBusy(true)
    try {
      let response: Response
      try {
        response = await fetch(`${base}/otazky-soubor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: await file.text(),
        })
      } catch {
        // Network outage — fetch itself returns no response.
        toast.error(t('library:claudeCodeImport.uploadOffline'))
        return
      }
      // The response may not be JSON (e.g. when the server crashes before it
      // sends a body) — without its own try/catch this would be lost as an
      // unhandled rejection and the teacher would see nothing at all.
      let data: { created?: number; rejected?: unknown[]; error?: string }
      try {
        data = (await response.json()) as { created?: number; rejected?: unknown[]; error?: string }
      } catch {
        toast.error(t('library:claudeCodeImport.uploadOffline'))
        return
      }
      if (!response.ok) {
        toast.error(data.error ?? t('library:claudeCodeImport.uploadFailed'))
        return
      }
      const rejected = data.rejected?.length ?? 0
      const uploaded = t('library:claudeCodeImport.uploaded', {
        questions: t('library:count.questions', { count: data.created ?? 0 }),
      })
      toast.success(rejected > 0 ? uploaded + t('library:claudeCodeImport.rejectedSuffix', { rejected }) : uploaded)
      router.refresh()
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
      <span>{t('library:claudeCodeImport.label')}</span>
      <Button asChild variant="outline" size="sm">
        <a href={`${base}/zdroj`} download>
          {t('library:claudeCodeImport.download')}
        </a>
      </Button>
      <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? t('library:claudeCodeImport.uploading') : t('library:claudeCodeImport.upload')}
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }}
      />
    </div>
  )
}
