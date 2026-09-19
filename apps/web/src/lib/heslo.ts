import 'server-only'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

/**
 * Hesla účtů. Běží jedině v Node runtime (route handlery, skripty) — do
 * `proxy.ts` se tenhle modul nesmí dostat ani přes řetěz importů, protože
 * `node:crypto` v Edge runtime není.
 *
 * Používá se `scrypt` ze standardní knihovny; žádná další závislost není
 * potřeba a parametry jsou uložené v samotném záznamu, takže se dají kdykoli
 * zvednout, aniž by se znehodnotila stará hesla.
 */

/**
 * `promisify` u `scrypt` ztratí přetížení s parametry, proto vlastní obal —
 * jinak by nešlo zvednout `N` bez obcházení typů.
 */
function scryptAsync(
  heslo: string,
  sul: Buffer,
  delka: number,
  parametry: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(heslo, sul, delka, parametry, (error, derived) => {
      if (error) reject(error)
      else resolve(derived)
    })
  })
}

const N = 16384
const R = 8
const P = 1
const DELKA = 64
const SUL_BAJTU = 16

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

export async function zahesovat(heslo: string): Promise<string> {
  const sul = randomBytes(SUL_BAJTU)
  const hash = await scryptAsync(heslo.normalize('NFKC'), sul, DELKA, {
    N,
    r: R,
    p: P,
    // Výchozí strop paměti na tyhle parametry nestačí.
    maxmem: 64 * 1024 * 1024,
  })
  return `scrypt$${N}$${R}$${P}$${base64url(sul)}$${base64url(hash)}`
}

/** Poškozený nebo prázdný záznam znamená „neodpovídá“, ne výjimku. */
export async function overitHeslo(heslo: string, zaznam: string | null): Promise<boolean> {
  if (!zaznam) return false
  const casti = zaznam.split('$')
  if (casti.length !== 6 || casti[0] !== 'scrypt') return false

  const [, n, r, p, sul, hash] = casti
  const parametry = { N: Number(n), r: Number(r), p: Number(p) }
  if (!Number.isFinite(parametry.N) || !Number.isFinite(parametry.r) || !Number.isFinite(parametry.p)) {
    return false
  }

  try {
    const ocekavany = Buffer.from(hash, 'base64url')
    const spocitany = await scryptAsync(
      heslo.normalize('NFKC'),
      Buffer.from(sul, 'base64url'),
      ocekavany.length,
      { ...parametry, maxmem: 64 * 1024 * 1024 },
    )
    return spocitany.length === ocekavany.length && timingSafeEqual(spocitany, ocekavany)
  } catch {
    return false
  }
}

export const MIN_DELKA_HESLA = 10

/** Vrátí českou hlášku, co je s heslem špatně, nebo `null`, když je v pořádku. */
export function zkontrolovatSilu(heslo: string): string | null {
  if (heslo.trim().length !== heslo.length) {
    return 'Heslo nesmí začínat ani končit mezerou.'
  }
  if (heslo.length < MIN_DELKA_HESLA) {
    return `Heslo musí mít aspoň ${MIN_DELKA_HESLA} znaků.`
  }
  return null
}

/**
 * Náhodné heslo, které správce přečte nahlas nebo opíše na papírek. Bez
 * znaků, které se v češtině pletou (0/O, 1/l/I), a po skupinách, aby se dalo
 * nadiktovat.
 */
export function vygenerovatHeslo(): string {
  const znaky = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bajty = randomBytes(16)
  const slovo = [...bajty].map((bajt) => znaky[bajt % znaky.length]).join('')
  return `${slovo.slice(0, 5)}-${slovo.slice(5, 10)}-${slovo.slice(10, 15)}`
}
