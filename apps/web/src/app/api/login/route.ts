import { z } from 'zod'
import { SESSION_COOKIE, sessionToken } from '@/lib/session'

export const runtime = 'nodejs'

const loginSchema = z.object({ password: z.string().min(1) })

export async function POST(request: Request) {
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
  if (parsed.data.password !== password) {
    return Response.json({ error: 'Heslo nesouhlasí.' }, { status: 401 })
  }

  const response = Response.json({ ok: true })
  response.headers.append(
    'set-cookie',
    `${SESSION_COOKIE}=${await sessionToken(password, secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  )
  return response
}
