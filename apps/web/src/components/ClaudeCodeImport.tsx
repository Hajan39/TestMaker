'use client'

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Button, toast } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/**
 * Questions written in Claude Code (`/otazky`): download the topic's materials
 * as text and upload the finished file back. Works even without a model in the app.
 */
export function ClaudeCodeImport({ topicId }: { topicId: string }) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const base = `/api/topics/${encodeURIComponent(topicId)}`

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      let response: Response
      try {
        response = await fetch(`${base}/otazky-soubor`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: await file.text(),
        })
      } catch {
        // Network outage — fetch itself returns no response.
        throw new Error(t('library:claudeCodeImport.uploadOffline'))
      }
      // The response may not be JSON (e.g. when the server crashes before it
      // sends a body) — without its own try/catch the teacher would see nothing at all.
      let data: { created?: number; rejected?: unknown[]; error?: string }
      try {
        data = (await response.json()) as { created?: number; rejected?: unknown[]; error?: string }
      } catch {
        throw new Error(t('library:claudeCodeImport.uploadOffline'))
      }
      if (!response.ok) throw new Error(data.error ?? t('library:claudeCodeImport.uploadFailed'))
      return data
    },
    onSuccess: (data) => {
      const rejected = data.rejected?.length ?? 0
      const uploaded = t('library:claudeCodeImport.uploaded', {
        questions: t('library:count.questions', { count: data.created ?? 0 }),
      })
      toast.success(rejected > 0 ? uploaded + t('library:claudeCodeImport.rejectedSuffix', { rejected }) : uploaded)
      router.refresh()
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => {
      if (input.current) input.current.value = ''
    },
  })
  const busy = uploadMutation.isPending

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-fg-muted">{t('library:claudeCodeImport.label')}</span>
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
          if (file) uploadMutation.mutate(file)
        }}
      />
    </div>
  )
}
