import { NextResponse, type NextRequest } from 'next/server'
import {
  AUTH_MISCONFIGURED_MESSAGE,
  SESSION_COOKIE,
  authMode,
  isValidSession,
} from '@/lib/session'

/** Statické soubory a favicon se neřeší, zbytek aplikace ano. */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const mode = authMode()

  // Špatně nastavené přihlašování (typicky nasazení bez APP_PASSWORD) nesmí
  // skončit tichým otevřením aplikace komukoli. Platí i pro /login — přihlásit
  // se stejně nedá, tak ať je aspoň vidět, co chybí.
  if (mode === 'chybne-nastaveno') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: AUTH_MISCONFIGURED_MESSAGE }, { status: 503 })
    }
    return new NextResponse(misconfiguredPage(), {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  if (pathname === '/login' || pathname === '/api/login') return NextResponse.next()
  if (mode === 'vypnuto') return NextResponse.next()

  // Plánovač se hlásí sdíleným tajemstvím; Vercel Cron posílá právě tuhle hlavičku.
  // Na Vercelu Hobby se cron nepoužívá (rozvrh po minutě tam neprojde a `crons`
  // v `vercel.json` shodí build), větev tu ale zůstává pro self-hosting:
  // naplánovaný `curl` na Synology se hlásí stejnou hlavičkou.
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

/**
 * Stránka se vypisuje ručně, ne přes React: middleware běží dřív než aplikace
 * a v tuhle chvíli nechceme pustit dál vůbec nic.
 */
function misconfiguredPage(): string {
  return `<!doctype html>
<html lang="cs">
<head><meta charset="utf-8"><title>Aplikace není nastavená</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 34rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.6">
<h1 style="font-size: 1.25rem">Aplikace není nastavená</h1>
<p>${AUTH_MISCONFIGURED_MESSAGE}</p>
</body>
</html>`
}
