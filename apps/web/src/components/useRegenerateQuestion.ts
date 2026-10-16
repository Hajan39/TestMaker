'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import {
  AI_QUESTION_TYPES,
  questionTypeLabel,
  type AiQuestionType,
  type QuestionType,
  type RegenerateReason,
} from '@testmaker/core/schema'
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
): {
  available: boolean
  busy: boolean
  run: (reason?: RegenerateReason, note?: string) => Promise<void>
  /** Converts the question to another type (same fact, same answer) — shares `busy` with `run`. */
  convert: (targetType: AiQuestionType) => Promise<void>
} {
  const router = useRouter()
  const configured = useAiConfigured()
  const regenerateMutation = useMutation({
    mutationFn: ({ reason, note, targetType }: { reason?: RegenerateReason; note?: string; targetType?: AiQuestionType }) =>
      requestJson(
        '/api/questions/regenerate',
        jsonBody('POST', { id: questionId, reason, note, targetType }),
        targetType ? t('generation:convert.failed') : t('generation:regenerate.failed'),
      ),
    onSuccess: (_data, { targetType }) => {
      if (targetType) {
        toast.success(t('generation:convert.done', { type: questionTypeLabel(targetType) }), {
          testId: 'toast-question-converted',
        })
      } else {
        toast.success(t('generation:regenerate.done'), { testId: 'toast-question-replaced' })
      }
      onDone?.()
      router.refresh()
    },
    onError: (error, { targetType }) =>
      toast.error(errorMessage(error, targetType ? t('generation:convert.failed') : t('generation:regenerate.failed'))),
  })

  const supportedType = (AI_QUESTION_TYPES as readonly string[]).includes(type)

  // Never rejects: the error is already shown by `onError`.
  const run = (reason?: RegenerateReason, note?: string) =>
    regenerateMutation.mutateAsync({ reason, note }).then(
      () => {},
      () => {},
    )

  const convert = (targetType: AiQuestionType) =>
    regenerateMutation.mutateAsync({ targetType }).then(
      () => {},
      () => {},
    )

  return { available: configured === true && supportedType, busy: regenerateMutation.isPending, run, convert }
}

/**
 * Is a model configured? `null` until the server answers. Shared by every AI
 * action, so the question is asked once per page load.
 */
export function useAiConfigured(): boolean | null {
  const [configured, setConfigured] = useState<boolean | null>(configuredCache)
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
  return configured
}
