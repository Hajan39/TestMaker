import { NextResponse, type NextRequest } from 'next/server'
import {
  AUTH_MISCONFIGURED_MESSAGE,
  NEPRIHLASEN_MESSAGE,
  SESSION_COOKIE,
  authMode,
  jeVolnaCesta,
  maPravo,
  obnovitRelaci,
  overitRelaci,
  relaceCookie,
  smazatStarouCookie,
} from '@/lib/session'

/** Statické soubory a favicon se neřeší, zbytek aplikace ano. */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const mode = authMode()

  // Špatně nastavené přihlašování (typicky nasazení bez AUTH_SECRET) nesmí
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

  if (jeVolnaCesta(pathname)) return NextResponse.next()
  if (mode === 'vypnuto') return NextResponse.next()

  // Plánovač se hlásí sdíleným tajemstvím; Vercel Cron posílá právě tuhle hlavičku.
  // Na Vercelu Hobby se cron nepoužívá (rozvrh po minutě tam neprojde a `crons`
  // v `vercel.json` shodí build), větev tu ale zůstává pro self-hosting:
  // naplánovaný `curl` na Synology se hlásí stejnou hlavičkou. Za koho úloha
  // generuje, si běh přečte z řádku fronty — relace tu žádná není.
  const cronSecret = process.env.CRON_SECRET
  if (
    pathname === '/api/jobs/run' &&
    cronSecret &&
    request.headers.get('authorization') === `Bearer ${cronSecret}`
  ) {
    return NextResponse.next()
  }

  const secret = process.env.AUTH_SECRET ?? ''
  const relace = await overitRelaci(request.cookies.get(SESSION_COOKIE)?.value, secret)
  if (!relace) return odmitnout(request, NEPRIHLASEN_MESSAGE)

  // Hrubé rozhodnutí podle role. Jestli je konkrétní písemka moje, rozhoduje
  // až server nad databází — proxy je pohodlí, ne bezpečnostní hranice.
  if (!maPravo(relace, pathname, request.method)) {
    // Administrace nad školami se jiné roli tváří jako neexistující, stejně
    // jako v route handlerech — 403 by prozradilo, že tu něco je.
    if (!relace.zh && pathname.startsWith('/api/administrace/')) {
      return NextResponse.json({ error: 'Nenalezeno' }, { status: 404 })
    }
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Na tuhle akci nemáte oprávnění.' }, { status: 403 })
    }
    const cil = request.nextUrl.clone()
    cil.pathname = relace.zh ? '/zmena-hesla' : '/'
    cil.search = ''
    return NextResponse.redirect(cil)
  }

  // Kdo pracuje, toho po dvanácti hodinách od přihlášení nevyhodí: po
  // polovině platnosti dostane čerstvou cookie.
  const odpoved = NextResponse.next()
  const cerstva = await obnovitRelaci(relace, secret)
  if (cerstva) odpoved.headers.append('set-cookie', relaceCookie(cerstva))
  return odpoved
}

/**
 * Nepřihlášenému se u stránky nabídne přihlášení a po něm návrat tam, kam
 * mířil — jinak by po každém vypršení relace skončil na úvodní obrazovce
 * a hledal, kde přestal.
 */
function odmitnout(request: NextRequest, duvod: string) {
  const { pathname, search } = request.nextUrl
  if (pathname.startsWith('/api/')) {
    const odpoved = NextResponse.json({ error: duvod }, { status: 401 })
    odpoved.headers.append('set-cookie', smazatStarouCookie())
    return odpoved
  }

  const login = request.nextUrl.clone()
  login.pathname = '/login'
  login.search = pathname === '/' ? '' : `?dal=${encodeURIComponent(pathname + search)}`
  const odpoved = NextResponse.redirect(login)
  odpoved.headers.append('set-cookie', smazatStarouCookie())
  return odpoved
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
