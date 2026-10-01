import 'server-only'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { t } from '@testmaker/core/i18n'

/**
 * Account passwords. Runs only in the Node runtime (route handlers, scripts) —
 * this module must not reach `proxy.ts` even through an import chain, because
 * the Edge runtime has no `node:crypto`.
 *
 * Uses `scrypt` from the standard library; no further dependency is needed
 * and the parameters are stored in the entry itself, so they can be raised at
 * any time without invalidating old passwords.
 */

/**
 * `promisify` on `scrypt` loses the overload with parameters, hence our own
 * wrapper — otherwise `N` could not be raised without bypassing the types.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  length: number,
  parameters: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, parameters, (error, derived) => {
      if (error) reject(error)
      else resolve(derived)
    })
  })
}

const N = 16384
const R = 8
const P = 1
const KEY_LENGTH = 64
const SALT_BYTES = 16

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    // The default memory cap is not enough for these parameters.
    maxmem: 64 * 1024 * 1024,
  })
  return `scrypt$${N}$${R}$${P}$${base64url(salt)}$${base64url(hash)}`
}

/** A damaged or empty entry means "does not match", not an exception. */
export async function verifyPassword(password: string, entry: string | null): Promise<boolean> {
  if (!entry) return false
  const parts = entry.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, n, r, p, salt, hash] = parts
  const parameters = { N: Number(n), r: Number(r), p: Number(p) }
  if (!Number.isFinite(parameters.N) || !Number.isFinite(parameters.r) || !Number.isFinite(parameters.p)) {
    return false
  }

  try {
    const expected = Buffer.from(hash, 'base64url')
    const counted = await scryptAsync(
      password.normalize('NFKC'),
      Buffer.from(salt, 'base64url'),
      expected.length,
      { ...parameters, maxmem: 64 * 1024 * 1024 },
    )
    return counted.length === expected.length && timingSafeEqual(counted, expected)
  } catch {
    return false
  }
}

export const MIN_PASSWORD_LENGTH = 10

/** Returns a message saying what is wrong with the password, or `null` when it is fine. */
export function checkPasswordStrength(password: string): string | null {
  if (password.trim().length !== password.length) {
    return t('auth:password.surroundingSpace')
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return t('auth:password.tooShort', { min: MIN_PASSWORD_LENGTH })
  }
  return null
}

/**
 * A random password a manager reads aloud or copies onto a slip of paper.
 * Without easily confused characters (0/O, 1/l/I), and in groups so it can be
 * dictated.
 */
export function generatePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(16)
  const word = [...bytes].map((byte) => chars[byte % chars.length]).join('')
  return `${word.slice(0, 5)}-${word.slice(5, 10)}-${word.slice(10, 15)}`
}
