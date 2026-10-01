import { t } from '../i18n'

/**
 * Errors from the model provider come in English and full of technical
 * references. From "You exceeded your current quota" the teacher cannot tell
 * whether to wait, pay or switch something. This layer translates them into a
 * sentence that makes clear what to do next.
 */

export interface AiFailure {
  /** Message for the UI, in the user's language. */
  message: string
  /** Does it make sense to try again later? */
  retryable: boolean
}

function textOf(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    return `${error.message} ${cause instanceof Error ? cause.message : ''}`
  }
  return String(error)
}

/** Letters that identify a message written in Czech (from our own checks). */
const CZECH_LETTERS = /[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚŤĎŇ]/u

/** Message for an unexpected model error. */
export function unknownAiErrorMessage(): string {
  return t('ai:errors.unknown')
}

/** Translates a model error into an understandable explanation. */
export function describeAiError(error: unknown): AiFailure {
  const raw = textOf(error)
  const lower = raw.toLowerCase()

  if (lower.includes('exceeded your current quota') || lower.includes('free_tier') || lower.includes('rate limit')) {
    return { message: t('ai:errors.quotaExceeded'), retryable: true }
  }
  if (lower.includes('experiencing high demand') || lower.includes('overloaded') || lower.includes('503')) {
    return { message: t('ai:errors.overloaded'), retryable: true }
  }
  if (lower.includes('api key') || lower.includes('unauthenticated') || lower.includes('permission denied')) {
    return { message: t('ai:errors.accessDenied'), retryable: false }
  }
  if (lower.includes('no longer available')) {
    return { message: t('ai:errors.modelUnavailable'), retryable: false }
  }
  if (lower.includes('aborted') || lower.includes('abort')) {
    return { message: t('ai:errors.aborted'), retryable: true }
  }

  if (lower.includes('no object generated') || lower.includes('did not match schema') || lower.includes('could not parse')) {
    return { message: t('ai:errors.badShape'), retryable: true }
  }
  if (lower.includes('fetch failed') || lower.includes('econnreset') || lower.includes('enotfound') || lower.includes('etimedout')) {
    return { message: t('ai:errors.network'), retryable: true }
  }

  // A message from our own checks is already localized and says what to do — keep it.
  if (CZECH_LETTERS.test(raw)) return { message: raw.trim().slice(0, 300), retryable: true }

  // The teacher cannot read an unknown English error; the raw text belongs in the server log.
  return { message: unknownAiErrorMessage(), retryable: true }
}
