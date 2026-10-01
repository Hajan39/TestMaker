import 'server-only'
import { createHash, randomBytes } from 'node:crypto'

/**
 * Přihlášení účtem Google, ručně a bez knihovny.
 *
 * Je to obyčejný OAuth 2.0 „authorization code" s PKCE: aplikace pošle
 * učitelku na Google, ten ji vrátí s kódem a kód se na serveru vymění za
 * tokeny. Knihovna typu NextAuth by sem přinesla vlastní model relací, který
 * už máme, a vlastní tabulky, které nechceme.
 */

export interface GoogleNastaveni {
  clientId: string
  clientSecret: string
  redirectUri: string
  /** Doména školních účtů; bez ní se přes Google nepřihlašuje. */
  hd: string | null
}

/** Nastavení z prostředí; `null` znamená „Google se nenabízí". */
export function googleNastaveni(
  env: Record<string, string | undefined> = process.env,
): GoogleNastaveni | null {
  const clientId = env.GOOGLE_CLIENT_ID
  const clientSecret = env.GOOGLE_CLIENT_SECRET
  const redirectUri = env.GOOGLE_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri, hd: env.GOOGLE_HD ?? null }
}

export const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

export interface OauthStav {
  state: string
  codeVerifier: string
  /** Kam se má uživatelka po přihlášení vrátit. */
  dal: string
}

export function novyOauthStav(dal: string): OauthStav {
  return { state: base64url(randomBytes(24)), codeVerifier: base64url(randomBytes(32)), dal }
}

export function codeChallenge(codeVerifier: string): string {
  return base64url(createHash('sha256').update(codeVerifier).digest())
}

/** Adresa, na kterou se uživatelka posílá k přihlášení. */
export function prihlasovaciAdresa(nastaveni: GoogleNastaveni, stav: OauthStav): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', nastaveni.clientId)
  url.searchParams.set('redirect_uri', nastaveni.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', stav.state)
  url.searchParams.set('code_challenge', codeChallenge(stav.codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')
  // Účet se vybírá pokaždé: ve sborovně se u jednoho počítače vystřídá víc lidí.
  url.searchParams.set('prompt', 'select_account')
  if (nastaveni.hd) url.searchParams.set('hd', nastaveni.hd)
  return url.toString()
}

export interface GoogleIdentita {
  sub: string
  email: string
  jmeno: string
  /** Doména účtu z Google Workspace. */
  hd: string | null
}

/**
 * Obsah `id_token` bez ověřování podpisu.
 *
 * Token přišel přímo z tokenového endpointu Googlu přes TLS, takže podle
 * OIDC podpis ověřovat nemusíme a klíče z JWKS není potřeba stahovat. Kdyby
 * se někdy `id_token` přebíral z prohlížeče (Google One Tap), musí se
 * ověřování podpisu doplnit — jinak by stačilo token vymyslet.
 */
export function rozebratIdToken(idToken: string): Record<string, unknown> | null {
  const cast = idToken.split('.')[1]
  if (!cast) return null
  try {
    return JSON.parse(Buffer.from(cast, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

const ISS = new Set(['accounts.google.com', 'https://accounts.google.com'])

/** Ověří nároky v tokenu a vytáhne z nich identitu, nebo českou hlášku. */
export function overitIdToken(
  idToken: string,
  nastaveni: GoogleNastaveni,
  now: number = Date.now(),
): { identita: GoogleIdentita } | { chyba: string } {
  const claims = rozebratIdToken(idToken)
  if (!claims) return { chyba: 'Od Googlu přišla odpověď, které nerozumíme. Zkuste to znovu.' }

  const iss = typeof claims.iss === 'string' ? claims.iss : ''
  const aud = typeof claims.aud === 'string' ? claims.aud : ''
  const exp = typeof claims.exp === 'number' ? claims.exp : 0
  if (!ISS.has(iss) || aud !== nastaveni.clientId || exp * 1000 <= now) {
    return { chyba: 'Přihlášení přes Google se nepodařilo ověřit. Zkuste to znovu.' }
  }

  const email = typeof claims.email === 'string' ? claims.email.toLowerCase() : ''
  if (!email || claims.email_verified !== true) {
    return { chyba: 'Google neověřil e-mail účtu, proto se s ním přihlásit nedá.' }
  }

  const hd = typeof claims.hd === 'string' ? claims.hd : null
  if (nastaveni.hd && hd !== nastaveni.hd) {
    return {
      chyba: `Přihlásit se jde jen účtem z domény ${nastaveni.hd}, ne soukromým Gmailem.`,
    }
  }

  const sub = typeof claims.sub === 'string' ? claims.sub : ''
  if (!sub) return { chyba: 'Od Googlu nepřišel identifikátor účtu.' }

  const jmeno = typeof claims.name === 'string' && claims.name ? claims.name : email
  return { identita: { sub, email, jmeno, hd } }
}

/** Výměna kódu za tokeny. Vrací `id_token`, nic jiného nepotřebujeme. */
export async function vymenitKod(
  nastaveni: GoogleNastaveni,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ idToken: string } | { chyba: string }> {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: nastaveni.clientId,
      client_secret: nastaveni.clientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: nastaveni.redirectUri,
    }),
  })
  if (!response.ok) {
    return { chyba: 'Google odmítl přihlášení. Zkuste to prosím znovu.' }
  }
  const data = (await response.json()) as { id_token?: string }
  if (!data.id_token) return { chyba: 'Od Googlu nepřišel přihlašovací token.' }
  return { idToken: data.id_token }
}

/**
 * Přesměrování, do kterého jde ještě přidat cookie. `Response.redirect()`
 * vrací odpověď se zamčenými hlavičkami, takže se k ní relace nedá připnout.
 */
export function presmeruj(cil: string | URL, cookies: string[] = []): Response {
  const headers = new Headers({ location: String(cil) })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status: 307, headers })
}

export { bezpecnyNavrat } from './navrat'
