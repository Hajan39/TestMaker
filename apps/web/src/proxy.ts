import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, isAuthDisabled, isValidSession } from '@/lib/session'

/** Statické soubory a favicon se neřeší, zbytek aplikace ano. */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/login' || pathname === '/api/login') return NextResponse.next()
  if (isAuthDisabled()) return NextResponse.next()

  // Plánovač se hlásí sdíleným tajemstvím; Vercel Cron posílá právě tuhle hlavičku.
  const cronSecret = process.env.CRON_SECRET
  if (
    pathname === '/api/jobs/run' &&
    cronSecret &&
    request.headers.get('authorization') === `Bearer ${cronSecret}`
  ) {
    return NextResponse.next()
  }

  const ok = await isValidSession(
    request.cookies.get(SESSION_COOKIE)?.value,
    process.env.APP_PASSWORD ?? '',
    process.env.AUTH_SECRET ?? '',
  )
  if (ok) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Nepřihlášeno' }, { status: 401 })
  }

  const login = request.nextUrl.clone()
  login.pathname = '/login'
  login.search = ''
  return NextResponse.redirect(login)
}
