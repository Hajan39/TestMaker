import 'server-only'
import { describeAiError } from '@testmaker/core/ai'
import { writeAudit } from '@/lib/user'

/** Longest technical detail stored with an event — enough for the provider's answer, not a whole log. */
const DETAIL_MAX = 1_200

/**
 * The technical side of an error for the manager: type, message, HTTP status
 * and the provider's answer, through the whole `cause` chain. The teacher
 * sees only the advice in Czech; without this the manager would have no way
 * to tell a used-up quota from a bug.
 */
export function technicalDetail(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && !seen.has(current) && parts.length < 6) {
    seen.add(current)
    if (current instanceof Error) {
      const extra = current as Error & {
        statusCode?: number
        responseBody?: string
        url?: string
        lastError?: unknown
        errors?: unknown[]
      }
      const status = extra.statusCode ? ` [HTTP ${extra.statusCode}]` : ''
      parts.push(`${current.name}${status}: ${current.message}`)
      if (typeof extra.responseBody === 'string' && extra.responseBody.trim()) {
        parts.push(`odpověď: ${extra.responseBody.trim().slice(0, 400)}`)
      }
      // The AI SDK wraps retried calls; the last attempt says the most.
      current = extra.lastError ?? extra.cause ?? (Array.isArray(extra.errors) ? extra.errors.at(-1) : undefined)
    } else {
      parts.push(typeof current === 'string' ? current : JSON.stringify(current))
      break
    }
  }
  const text = parts.join(' ← ')
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string })?.name === 'AbortError'
}

/**
 * Logs a failed generation into the school's events (Správa → Události) with
 * the technical detail, and returns the Czech message for the teacher. An
 * abort (the teacher left the page) is not a failure and is not logged.
 */
export async function reportAiFailure(
  who: { schoolId: string; userId: string | null },
  entry: { action: string; entity?: string; entityId?: string | null; error: unknown },
): Promise<string> {
  const { message } = describeAiError(entry.error)
  console.error(`${entry.action}:`, entry.error)
  if (!isAbort(entry.error)) {
    await writeAudit({
      schoolId: who.schoolId,
      userId: who.userId,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      detail: { message, technicky: technicalDetail(entry.error) },
      severity: 'chyba',
    })
  }
  return message
}
