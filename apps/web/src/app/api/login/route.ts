import { z } from 'zod'
import {
  LOGIN_MAX_ATTEMPTS,
  SESSION_COOKIE,
  clearLoginAttempts,
  equalConstantTime,
  recordLoginAttempt,
  sessionToken,
} from '@/lib/session'

export const runtime = 'nodejs'

const loginSchema = z.object({ password: z.string().min(1) })

/** Zdržení po chybném hesle: zpomalí zkoušení a uživatelka si ho nevšimne. */
const WRONG_PASSWORD_DELAY_MS = 400

export async function POST(request: Request) {
  // Adresa volajícího. Za Vercelem je skutečná adresa v `x-forwarded-for`;
  // když hlavička chybí, počítají se pokusy dohromady — pro jednu uživatelku
  // je to přijatelné, zamknout by se tím dala nanejvýš ona sama.
  const client = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'neznámá-adresa'

  const attempt = recordLoginAttempt(client)
  if (!attempt.allowed) {
    return Response.json(
      {
        error: `Příliš mnoho pokusů o přihlášení. Zkuste to znovu za ${Math.ceil(attempt.retryAfterSeconds / 60)} min.`,
      },
      { status: 429, headers: { 'retry-after': String(attempt.retryAfterSeconds) } },
    )
  }

  const parsed = loginSchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Vyplň heslo.' }, { status: 400 })
  }

  const password = process.env.APP_PASSWORD
  const secret = process.env.AUTH_SECRET
  if (!password || !secret) {
    return Response.json(
      { error: 'Přihlašování není nastavené — chybí APP_PASSWORD nebo AUTH_SECRET.' },
      { status: 503 },
    )
  }
  if (!equalConstantTime(parsed.data.password, password)) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS))
    return Response.json(
      {
        error:
          attempt.remaining <= 3
            ? `Heslo nesouhlasí. Zbývající pokusy: ${attempt.remaining} z ${LOGIN_MAX_ATTEMPTS}. Po vyčerpání se přihlašování na 15 minut uzavře.`
            : 'Heslo nesouhlasí.',
      },
      { status: 401 },
    )
  }

  // Po úspěchu nemá smysl si pokusy pamatovat: příště se přihlašuje znovu načisto.
  clearLoginAttempts(client)

  const response = Response.json({ ok: true })
  response.headers.append(
    'set-cookie',
    `${SESSION_COOKIE}=${await sessionToken(password, secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  )
  return response
}
