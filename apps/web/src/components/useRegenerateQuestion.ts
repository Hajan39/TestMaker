'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AI_QUESTION_TYPES, type QuestionType, type RegenerateReason } from '@testmaker/core/schema'
import { toast } from '@testmaker/ui'
import { errorMessage, jsonBody, requestJson } from '@/lib/requestJson'
import { t } from '@testmaker/core/i18n'

/** Cached answer to “is a model configured?” — asked once per page load. */
let configuredCache: boolean | null = null

/**
 * Replaces one question via the model — regardless of what triggers it (a
 * button in review, a menu item in the bank).
 *
 * `available` is `false` until we know a model is configured, and also for
 * types the model cannot produce (e.g. image labelling). Callers do not offer
 * the action at all then — otherwise the teacher would click and only learn
 * from an error. The original question is rejected only once the replacement
 * exists; the server ensures that.
 */
export function useRegenerateQuestion(
  questionId: string,
  type: QuestionType,
  onDone?: () => void,
): { available: boolean; busy: boolean; run: (reason?: RegenerateReason, note?: string) => Promise<void> } {
  const router = useRouter()
  const [configured, setConfigured] = useState<boolean | null>(configuredCache)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (configuredCache !== null) return
    let valid = true
    fetch('/api/questions/regenerate')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { configured?: boolean } | null) => {
        if (typeof data?.configured !== 'boolean') return
        configuredCache = data.configured
        if (valid) setConfigured(data.configured)
      })
      .catch(() => {})
    return () => {
      valid = false
    }
  }, [])

  const supportedType = (AI_QUESTION_TYPES as readonly string[]).includes(type)

  async function run(reason?: RegenerateReason, note?: string) {
    setBusy(true)
    try {
      await requestJson(
        '/api/questions/regenerate',
        jsonBody('POST', { id: questionId, reason, note }),
        t('generation:regenerate.failed'),
      )
      toast.success(t('generation:regenerate.done'), { testId: 'toast-question-replaced' })
      onDone?.()
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, t('generation:regenerate.failed')))
    } finally {
      setBusy(false)
    }
  }

  return { available: configured === true && supportedType, busy, run }
}
