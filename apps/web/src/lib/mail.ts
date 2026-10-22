import 'server-only'

/**
 * Transactional e-mail through Brevo's HTTP API — a plain `fetch`, no SDK.
 * Optional: without `BREVO_API_KEY` and `MAIL_FROM` the app sends nothing and
 * the interface hides the e-mail buttons (`isMailConfigured`).
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

export interface MailSettings {
  apiKey: string
  /** Sender address verified in Brevo — Brevo rejects any other. */
  from: string
  fromName: string
}

export function mailSettings(env: Record<string, string | undefined> = process.env): MailSettings | null {
  const apiKey = env.BREVO_API_KEY?.trim()
  const from = env.MAIL_FROM?.trim()
  if (!apiKey || !from) return null
  return { apiKey, from, fromName: env.MAIL_FROM_NAME?.trim() || 'TestMaker' }
}

export function isMailConfigured(env?: Record<string, string | undefined>): boolean {
  return mailSettings(env) !== null
}

export interface MailMessage {
  to: { email: string; name: string }
  subject: string
  html: string
  text: string
}

/** Brevo refused or could not be reached; `detail` is for the server log only. */
export class MailError extends Error {
  constructor(readonly detail: string) {
    super('Mail was not sent')
    this.name = 'MailError'
  }
}

export async function sendMail(settings: MailSettings, message: MailMessage): Promise<void> {
  let response: Response
  try {
    response = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: { 'api-key': settings.apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: settings.from, name: settings.fromName },
        to: [message.to],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
    })
  } catch (error) {
    throw new MailError(`Brevo unreachable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new MailError(`Brevo ${response.status}: ${body.slice(0, 500)}`)
  }
}

/** Text for an HTML body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** E-mails one account may send per hour. */
export const MAIL_MAX_PER_HOUR = 5
const MAIL_WINDOW_MS = 60 * 60 * 1000

// ponytail: per-instance memory like the login limiter; on serverless each
// instance counts on its own, so the real ceiling is 5 × instances. Count
// audit rows instead if that ever matters.
const sent = new Map<string, number[]>()

/** Records one send for the account; `false` when it is over the hourly limit. */
export function allowMail(userId: string, now: number = Date.now()): boolean {
  const recent = (sent.get(userId) ?? []).filter((at) => now - at < MAIL_WINDOW_MS)
  if (recent.length >= MAIL_MAX_PER_HOUR) {
    sent.set(userId, recent)
    return false
  }
  sent.set(userId, [...recent, now])
  return true
}

/** Forgets the counters — for tests. */
export function resetMailLimits(): void {
  sent.clear()
}
