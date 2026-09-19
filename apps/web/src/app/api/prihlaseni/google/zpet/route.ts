import { and, eq } from 'drizzle-orm'
import { db, schools, users } from '@/db'
import { OAUTH_COOKIE } from '@/lib/session'
import {
  bezpecnyNavrat,
  googleNastaveni,
  overitIdToken,
  presmeruj,
  vymenitKod,
  type OauthStav,
} from '@/lib/google'
import { zalozitRelaci, zapsatAudit } from '@/lib/uzivatel'

export const runtime = 'nodejs'

/** Cookie se stavem se čte jednou a hned zahazuje — proti přehrání odpovědi. */
function precistStav(request: Request): OauthStav | null {
  const cookie = request.headers
    .get('cookie')
    ?.split(';')
    .map((kus) => kus.trim())
    .find((kus) => kus.startsWith(`${OAUTH_COOKIE}=`))
  if (!cookie) return null
  try {
    const stav = JSON.parse(decodeURIComponent(cookie.slice(OAUTH_COOKIE.length + 1))) as OauthStav
    return stav.state && stav.codeVerifier ? stav : null
  } catch {
    return null
  }
}

function smazatStav(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${OAUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

function zpetSChybou(origin: string, chyba: string): Response {
  const login = new URL('/login', origin)
  login.searchParams.set('chyba', chyba)
  return presmeruj(login, [smazatStav()])
}

/**
 * Návrat od Googlu. Ověří se stav, kód se vymění za `id_token` a z něj se
 * vezme identita. Účet, který v aplikaci není, se podle nastavení školy buď
 * odmítne, nebo založí jako čekající — sám od sebe dovnitř neprojde ani tak.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const nastaveni = googleNastaveni()
  if (!nastaveni) {
    return zpetSChybou(url.origin, 'Přihlášení přes Google není v této instalaci nastavené.')
  }

  const stav = precistStav(request)
  const code = url.searchParams.get('code')
  if (!stav || !code || url.searchParams.get('state') !== stav.state) {
    return zpetSChybou(url.origin, 'Přihlášení přes Google vypršelo. Zkuste to prosím znovu.')
  }

  const vymena = await vymenitKod(nastaveni, code, stav.codeVerifier)
  if ('chyba' in vymena) return zpetSChybou(url.origin, vymena.chyba)

  const overeni = overitIdToken(vymena.idToken, nastaveni)
  if ('chyba' in overeni) return zpetSChybou(url.origin, overeni.chyba)
  const { identita } = overeni

  // Škola se pozná podle domény účtu; bez ní se přihlásit nedá.
  const [skola] = identita.hd
    ? await db.select().from(schools).where(eq(schools.googleDomain, identita.hd)).limit(1)
    : []
  if (!skola) {
    return zpetSChybou(
      url.origin,
      `Doména ${identita.hd ?? 'účtu'} není v TestMakeru zavedená. Požádejte správce.`,
    )
  }

  // Nejdřív podle trvalého identifikátoru, pak podle e-mailu: účet založený
  // s heslem se tím k Googlu jen připojí, druhý vedle něj nevzniká.
  const [podleSub] = await db.select().from(users).where(eq(users.googleSub, identita.sub)).limit(1)
  const [podleEmailu] = podleSub
    ? []
    : await db
        .select()
        .from(users)
        .where(and(eq(users.email, identita.email), eq(users.schoolId, skola.id)))
        .limit(1)
  const ucet = podleSub ?? podleEmailu

  if (!ucet) {
    if (!skola.googleAutoJoin) {
      await zapsatAudit({
        schoolId: skola.id,
        action: 'google-neznamy-ucet',
        detail: { email: identita.email },
        severity: 'chyba',
      })
      return zpetSChybou(
        url.origin,
        `Účet ${identita.email} nemá v TestMakeru přístup. Požádejte správce o založení.`,
      )
    }

    // Čekající účet nemá roli, se kterou by šlo pracovat — dokud ho správce
    // neschválí, přihlásit se s ním nedá.
    await db.insert(users).values({
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      schoolId: skola.id,
      email: identita.email,
      name: identita.jmeno,
      role: 'nahled',
      googleSub: identita.sub,
      status: 'ceka',
    })
    await zapsatAudit({
      schoolId: skola.id,
      action: 'google-cekajici-ucet',
      detail: { email: identita.email },
    })
    return zpetSChybou(
      url.origin,
      'Účet jsme zaevidovali. Přihlásit se půjde, jakmile ho správce schválí.',
    )
  }

  if (ucet.status !== 'aktivni') {
    return zpetSChybou(
      url.origin,
      ucet.status === 'ceka'
        ? 'Účet zatím nemá přidělenou roli. Požádejte správce o schválení.'
        : 'Účet je zablokovaný. Obraťte se na správce.',
    )
  }

  // Spárování při prvním přihlášení Googlem k účtu založenému s heslem.
  if (!ucet.googleSub) {
    await db.update(users).set({ googleSub: identita.sub }).where(eq(users.id, ucet.id))
  }

  const cookie = await zalozitRelaci(ucet.id, {
    ip: request.headers.get('x-forwarded-for'),
    userAgent: request.headers.get('user-agent'),
  })
  await zapsatAudit({
    schoolId: ucet.schoolId,
    userId: ucet.id,
    action: 'prihlaseni-google',
    ip: request.headers.get('x-forwarded-for'),
  })

  const cil = new URL(ucet.mustChangePassword ? '/zmena-hesla' : bezpecnyNavrat(stav.dal), url.origin)
  return presmeruj(cil, [cookie, smazatStav()])
}
