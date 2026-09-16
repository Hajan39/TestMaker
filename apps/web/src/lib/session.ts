/**
 * Přihlášení jedním sdíleným heslem. Cookie nese HMAC-SHA256 z hesla
 * klíčem `AUTH_SECRET` — v cookie tedy heslo samotné není a bez tajemství
 * ji nikdo nevyrobí. Používá Web Crypto, protože `node:crypto` v Edge
 * runtime middlewaru není k dispozici.
 */
export const SESSION_COOKIE = 'tm_session'

const encoder = new TextEncoder()

export async function sessionToken(password: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(password))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function isValidSession(
  value: string | undefined,
  password: string,
  secret: string,
): Promise<boolean> {
  if (!value) return false
  return equalConstantTime(value, await sessionToken(password, secret))
}

/**
 * Tři stavy přihlašování:
 *
 * - `zapnuto` — je heslo i tajemství, aplikace se chrání,
 * - `vypnuto` — není heslo a neběžíme v nasazení; tak se aplikace používá
 *   lokálně (`next dev`) i v testech v prohlížeči, kde by přihlašování jen
 *   překáželo,
 * - `chybne-nastaveno` — nastavení nedává smysl a mlčky otevřít aplikaci by
 *   bylo nebezpečné: buď běžíme na Vercelu (veřejná adresa) bez hesla, nebo
 *   je heslo bez tajemství, takže by se nedalo přihlásit. V obou případech
 *   aplikace odpoví 503 a řekne, co doplnit.
 */
export type AuthMode = 'zapnuto' | 'vypnuto' | 'chybne-nastaveno'

/** Hláška k `chybne-nastaveno` — vysvětluje majitelce, co ve Vercelu doplnit. */
export const AUTH_MISCONFIGURED_MESSAGE =
  'Přihlašování není nastavené. Doplňte proměnné prostředí APP_PASSWORD (heslo do aplikace) ' +
  'a AUTH_SECRET (náhodný řetězec, např. z `openssl rand -hex 32`) a nasazení spusťte znovu. ' +
  'Bez nich by byla aplikace veřejně přístupná komukoli, proto zůstává zavřená.'

export function authMode(env: Record<string, string | undefined> = process.env): AuthMode {
  const password = env.APP_PASSWORD
  const secret = env.AUTH_SECRET
  if (password && secret) return 'zapnuto'
  // Heslo bez tajemství: přihlásit se nedá, tichý běh bez ochrany by byl past.
  if (password && !secret) return 'chybne-nastaveno'
  // `VERCEL` nastavuje Vercel sám ve všech svých prostředích. Je to jediné
  // rozlišení mezi „běží to na veřejné adrese“ a „běží to na notebooku“.
  if (env.VERCEL) return 'chybne-nastaveno'
  return 'vypnuto'
}

/** Bez nastaveného hesla aplikace běží nechráněná — tak ji používáme lokálně. */
export function isAuthDisabled(env?: Record<string, string | undefined>): boolean {
  return authMode(env) === 'vypnuto'
}

/** Porovnání nezávislé na délce shodné předpony, ať se podpis nedá uhodnout po znacích. */
export function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Omezení pokusů o přihlášení. Heslo je jedno jediné a krátké, takže bez
 * počítadla by ho šlo z venku zkoušet donekonečna. Počítá se v paměti procesu:
 * pro jednu uživatelku to stačí, po restartu (nebo na jiné instanci funkce)
 * se počítadlo vynuluje — proti hrubé síle z jedné adresy to pořád zabere.
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

/** Zaznamená pokus o přihlášení z dané adresy a řekne, jestli se má vyřídit. */
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
