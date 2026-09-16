import { SESSION_COOKIE } from '@/lib/session'

export const runtime = 'nodejs'

/** Odhlášení: cookie se přepíše prázdnou s nulovou platností, prohlížeč ji zahodí. */
export async function POST() {
  const response = Response.json({ ok: true })
  response.headers.append(
    'set-cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  )
  return response
}
