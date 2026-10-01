/**
 * Relace: podepsaná cookie plus řádek v tabulce `sessions`.
 *
 * Cookie nese `base64url(JSON).hex(HMAC-SHA256)` — kdo zná `AUTH_SECRET`, umí
 * ji vyrobit, nikdo jiný ne. Podpis i platnost se dají ověřit bez databáze,
 * což je nutné: tenhle modul čte `proxy.ts`, který běží v Edge runtime.
 * Proto tu není jediný import z `@/db` ani z `node:crypto` — hlídá to test
 * `test/modul-proxy.test.ts`.
 *
 * Co cookie sama neumí, je odvolání: dokud nevyprší, platí. Proto k ní patří
 * řádek v `sessions` (odhlášení jednoho zařízení) a číslo `sessionVersion`
 * u účtu (odhlášení ze všech). Obojí se kontroluje až na serveru
 * v `lib/uzivatel.ts`.
 */
import { roleJeAdministrator, roleMuzeSpravovat, type Role } from './role'

export type { Role } from './role'

export const SESSION_COOKIE = 'tm_relace'

/**
 * Cookie ze starého přihlašování jedním heslem. Nový kód ji nečte, jen ji
 * v odpovědi maže, aby v prohlížeči nestrašila.
 */
export const STARA_COOKIE = 'tm_session'

/** Cookie s `state` a `code_verifier` po dobu přesměrování na Google. */
export const OAUTH_COOKIE = 'tm_oauth'

/** Klouzavá platnost cookie: po polovině se vydá čerstvá. */
export const RELACE_TTL_MS = 12 * 60 * 60 * 1000

/** Nejzazší platnost relace bez ohledu na to, jak se používá. */
export const RELACE_MAX_MS = 30 * 24 * 60 * 60 * 1000

export interface Relace {
  v: 1
  /** Uživatel. */
  uid: string
  /** Škola — aby proxy nemusela do databáze kvůli rozhodnutí o cestě. */
  sch: string
  /** Řádek v `sessions`; podle něj jde relaci odvolat. */
  sid: string
  role: Role
  /** `users.sessionVersion` v době vydání. */
  sv: number
  /** Konec platnosti v milisekundách. */
  exp: number
  /** Účet po resetu hesla smí jen na `/zmena-hesla`. */
  zh?: boolean
}

const encoder = new TextEncoder()

function base64urlEncode(text: string): string {
  const bytes = encoder.encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlDecode(value: string): string | null {
  try {
    const doplneno = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(doplneno.padEnd(Math.ceil(doplneno.length / 4) * 4, '='))
    const bytes = Uint8Array.from(binary, (znak) => znak.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

async function podpis(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function podepsatRelaci(relace: Omit<Relace, 'v'>, secret: string): Promise<string> {
  const obsah = base64urlEncode(JSON.stringify({ v: 1, ...relace }))
  return `${obsah}.${await podpis(obsah, secret)}`
}

/** Vrátí obsah cookie, jen když sedí podpis i platnost. Jinak `null`. */
export async function overitRelaci(
  hodnota: string | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<Relace | null> {
  if (!hodnota || !secret) return null
  const tecka = hodnota.lastIndexOf('.')
  if (tecka <= 0) return null

  const obsah = hodnota.slice(0, tecka)
  const dodany = hodnota.slice(tecka + 1)
  if (!equalConstantTime(dodany, await podpis(obsah, secret))) return null

  const json = base64urlDecode(obsah)
  if (!json) return null

  let relace: Relace
  try {
    relace = JSON.parse(json) as Relace
  } catch {
    return null
  }

  if (relace.v !== 1) return null
  if (typeof relace.uid !== 'string' || typeof relace.sid !== 'string') return null
  if (typeof relace.exp !== 'number' || relace.exp <= now) return null
  return relace
}

/**
 * Čerstvý token, když relace přešla polovinu platnosti; jinak `null`.
 * Strop `RELACE_MAX_MS` hlídá řádek v `sessions`, takže prodlužovat cookie
 * stačí bez databáze — proto to zvládne i proxy.
 */
export async function obnovitRelaci(
  relace: Relace,
  secret: string,
  now: number = Date.now(),
): Promise<string | null> {
  if (relace.exp - now > RELACE_TTL_MS / 2) return null
  return podepsatRelaci({ ...relace, exp: now + RELACE_TTL_MS }, secret)
}

/** Text pro API, když chybí platná relace. Klient ho čte učitelce. */
export const NEPRIHLASEN_MESSAGE =
  'Přihlášení vypršelo. Přihlas se znovu v nové záložce — rozdělaná práce v tomhle okně zůstane — a zkus to znovu.'

/** Hlavička `Set-Cookie`; `null` místo tokenu cookie smaže. */
export function relaceCookie(
  token: string | null,
  env: Record<string, string | undefined> = process.env,
): string {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : ''
  if (token === null) {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  }
  const maxAge = Math.floor(RELACE_TTL_MS / 1000)
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

/** Hlavička, která zahodí cookie starého přihlašování jedním heslem. */
export function smazatStarouCookie(env: Record<string, string | undefined> = process.env): string {
  const secure = env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${STARA_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

/**
 * Tři stavy přihlašování:
 *
 * - `zapnuto` — je `AUTH_SECRET`, aplikace se chrání účty,
 * - `vypnuto` — tajemství není a neběžíme v nasazení; tak se aplikace používá
 *   lokálně (`next dev`) i v testech v prohlížeči, kde by přihlašování jen
 *   překáželo. Zapisuje se přitom pod výchozím účtem, viz `lib/uzivatel.ts`.
 * - `chybne-nastaveno` — běžíme na veřejné adrese bez tajemství. Mlčky otevřít
 *   aplikaci komukoli by bylo nebezpečné, proto 503 a vysvětlení.
 */
export type AuthMode = 'zapnuto' | 'vypnuto' | 'chybne-nastaveno'

export const AUTH_MISCONFIGURED_MESSAGE =
  'Přihlašování není nastavené. Doplňte proměnnou prostředí AUTH_SECRET (náhodný řetězec, ' +
  'např. z `openssl rand -hex 32`) a nasazení spusťte znovu. Účty se zakládají skriptem ' +
  '`pnpm --filter @testmaker/web uzivatel`. Bez tajemství by byla aplikace veřejně přístupná ' +
  'komukoli, proto zůstává zavřená.'

export function authMode(env: Record<string, string | undefined> = process.env): AuthMode {
  if (env.AUTH_SECRET) return 'zapnuto'
  // `VERCEL` nastavuje Vercel sám ve všech svých prostředích. Je to jediné
  // rozlišení mezi „běží to na veřejné adrese“ a „běží to na notebooku“.
  if (env.VERCEL) return 'chybne-nastaveno'
  return 'vypnuto'
}

/** Bez tajemství aplikace běží nechráněná — tak ji používáme lokálně. */
export function isAuthDisabled(env?: Record<string, string | undefined>): boolean {
  return authMode(env) === 'vypnuto'
}

/** Cesty, na které se dostane i nepřihlášený. */
export function jeVolnaCesta(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/api/login' ||
    pathname === '/api/logout' ||
    pathname.startsWith('/api/prihlaseni/google')
  )
}

/**
 * Hrubé rozhodnutí podle role, které zvládne i proxy bez databáze:
 *
 * - do správy školy smí správce a administrátor, do administrace škol jedině
 *   administrátor,
 * - náhled smí číst a tisknout (tisk je `GET`), ale nic nemění,
 * - kdo má vynucenou změnu hesla, nesmí zatím nikam jinam.
 *
 * Jemné rozhodování („je tohle moje písemka?“) sem nepatří — to dělají
 * serverové funkce, které mají po ruce databázi. Proxy je pohodlí, ne
 * bezpečnostní hranice.
 */
export function maPravo(relace: Relace, pathname: string, method: string): boolean {
  const cteni = method === 'GET' || method === 'HEAD'

  if (relace.zh) {
    return pathname === '/zmena-hesla' || pathname === '/api/zmena-hesla' || pathname === '/api/logout'
  }
  if (jeCesta(pathname, '/administrace') || pathname.startsWith('/api/administrace/')) {
    return roleJeAdministrator(relace.role)
  }
  if (jeCesta(pathname, '/sprava') || pathname.startsWith('/api/sprava/')) {
    return roleMuzeSpravovat(relace.role)
  }
  if (relace.role === 'nahled') return cteni
  return true
}

function jeCesta(pathname: string, zaklad: string): boolean {
  return pathname === zaklad || pathname.startsWith(`${zaklad}/`)
}

/** Porovnání nezávislé na délce shodné předpony, ať se podpis nedá uhodnout po znacích. */
export function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Omezení pokusů o přihlášení v paměti procesu. Je to jen první brzda proti
 * zkoušení hesla z jedné adresy; trvalé počítadlo má každý účet v databázi
 * (`users.failedLogins`, `lockedUntil`), protože na serverless má každá
 * instance funkce vlastní paměť.
 *
 * Klíč je dvojice účtu a adresy, ne samotná adresa: ve sborovně chodí všichni
 * z jedné IP a jinak by se zamykali navzájem.
 */
export const LOGIN_MAX_ATTEMPTS = 10
export const LOGIN_WINDOW_MS = 15 * 60 * 1000

interface AttemptRecord {
  count: number
  /** Kdy okno začalo; po `LOGIN_WINDOW_MS` se počítadlo zahodí. */
  startedAt: number
}

const attempts = new Map<string, AttemptRecord>()

export interface LoginAttemptResult {
  allowed: boolean
  /** Kolik vteřin zbývá do uvolnění; jen když `allowed` je false. */
  retryAfterSeconds: number
  remaining: number
}

/** Zaznamená pokus o přihlášení a řekne, jestli se má vyřídit. */
export function recordLoginAttempt(key: string, now: number = Date.now()): LoginAttemptResult {
  const record = attempts.get(key)
  if (!record || now - record.startedAt >= LOGIN_WINDOW_MS) {
    attempts.set(key, { count: 1, startedAt: now })
    return { allowed: true, retryAfterSeconds: 0, remaining: LOGIN_MAX_ATTEMPTS - 1 }
  }

  record.count += 1
  if (record.count > LOGIN_MAX_ATTEMPTS) {
    const waitMs = record.startedAt + LOGIN_WINDOW_MS - now
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
      remaining: 0,
    }
  }
  return { allowed: true, retryAfterSeconds: 0, remaining: LOGIN_MAX_ATTEMPTS - record.count }
}

/** Po úspěšném přihlášení nemá smysl si pokusy pamatovat. */
export function clearLoginAttempts(key?: string): void {
  if (key === undefined) attempts.clear()
  else attempts.delete(key)
}
