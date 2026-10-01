import { t } from '@testmaker/core/i18n'
import { NextResponse, type NextRequest } from 'next/server'
import {
  SESSION_COOKIE,
  authMode,
  isPublicPath,
  isAllowed,
  refreshSession,
  verifySession,
  sessionCookie,
  clearLegacyCookie,
} from '@/lib/session'

/** Static files and the favicon are skipped, the rest of the app is not. */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const mode = authMode()

  // Misconfigured sign-in (typically a deployment without AUTH_SECRET) must
  // not silently open the app to anyone. Applies to /login too — signing in
  // is impossible anyway, so at least show what is missing.
  if (mode === 'chybne-nastaveno') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: t('api:authMisconfigured') }, { status: 503 })
    }
    return new NextResponse(misconfiguredPage(), {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  if (isPublicPath(pathname)) return NextResponse.next()
  if (mode === 'vypnuto') return NextResponse.next()

  // The scheduler authenticates with a shared secret; Vercel Cron sends exactly
  // this header. Vercel Hobby uses no cron (a per-minute schedule is rejected
  // and `crons` in `vercel.json` breaks the build), but the branch stays for
  // self-hosting: a scheduled `curl` on Synology sends the same header. The run
  // reads whom the job generates for from the queue row — there is no session.
  const cronSecret = process.env.CRON_SECRET
  if (
    pathname === '/api/jobs/run' &&
    cronSecret &&
    request.headers.get('authorization') === `Bearer ${cronSecret}`
  ) {
    return NextResponse.next()
  }

  const secret = process.env.AUTH_SECRET ?? ''
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, secret)
  if (!session) return reject(request, t('api:notSignedIn'))

  // Coarse decision by role. Whether a particular test is mine is decided
  // later by the server over the database — the proxy is a convenience, not a
  // security boundary.
  if (!isAllowed(session, pathname, request.method)) {
    // School administration looks non-existent to other roles, as in the
    // route handlers — a 403 would reveal that something is here.
    if (!session.zh && pathname.startsWith('/api/administrace/')) {
      return NextResponse.json({ error: t('api:notFound') }, { status: 404 })
    }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: t('api:forbidden') }, { status: 403 })
    }
    const target = request.nextUrl.clone()
    target.pathname = session.zh ? '/zmena-hesla' : '/'
    target.search = ''
    return NextResponse.redirect(target)
  }

  // Someone who keeps working is not kicked out twelve hours after signing
  // in: past half the lifetime they get a fresh cookie.
  const response = NextResponse.next()
  const fresh = await refreshSession(session, secret)
  if (fresh) response.headers.append('set-cookie', sessionCookie(fresh))
  return response
}

/**
 * A signed-out visitor of a page is offered sign-in and afterwards a return
 * to where they were heading — otherwise every session expiry would land them
 * on the home screen looking for where they left off.
 */
function reject(request: NextRequest, reason: string) {
  const { pathname, search } = request.nextUrl
  if (pathname.startsWith('/api/')) {
    const response = NextResponse.json({ error: reason }, { status: 401 })
    response.headers.append('set-cookie', clearLegacyCookie())
    return response
  }

  const login = request.nextUrl.clone()
  login.pathname = '/login'
  login.search = pathname === '/' ? '' : `?dal=${encodeURIComponent(pathname + search)}`
  const response = NextResponse.redirect(login)
  response.headers.append('set-cookie', clearLegacyCookie())
  return response
}

/**
 * The page is written by hand, not via React: the middleware runs before the
 * app and at this point we want to let nothing through at all.
 */
function misconfiguredPage(): string {
  return `<!doctype html>
<html lang="cs">
<head><meta charset="utf-8"><title>${t('api:authMisconfiguredTitle')}</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 34rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.6">
<h1 style="font-size: 1.25rem">${t('api:authMisconfiguredTitle')}</h1>
<p>${t('api:authMisconfigured')}</p>
</body>
</html>`
}
