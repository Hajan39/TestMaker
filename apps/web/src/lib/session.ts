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

/** Bez nastaveného hesla aplikace běží nechráněná — tak ji používáme lokálně. */
export function isAuthDisabled(): boolean {
  return !process.env.APP_PASSWORD
}

/** Porovnání nezávislé na délce shodné předpony, ať se podpis nedá uhodnout po znacích. */
function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
