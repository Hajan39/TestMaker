/**
 * Rozpoznání téhož obsahu ve dvou materiálech. Typický případ: prezentace `.odp`
 * a její PDF export leží ve stejné složce a nesou stejný text.
 */

/** Slova bez diakritiky, interpunkce a velikosti písmen. */
function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1)
}

/** Množina n-gramů (výchozí 4 slova) — odolná vůči přeházeným odstavcům. */
export function shingles(text: string, size = 4): Set<string> {
  const tokens = tokenize(text)
  const result = new Set<string>()
  for (let i = 0; i + size <= tokens.length; i += 1) {
    result.add(tokens.slice(i, i + size).join(' '))
  }
  return result
}

/**
 * Podíl společných n-gramů vůči menšímu z dokumentů.
 * Na rozdíl od Jaccardu odhalí i případ, kdy jedna verze obsahuje navíc
 * poznámky přednášejícího, a přesto jde o tentýž materiál.
 */
export function containmentSimilarity(a: string, b: string, size = 4): number {
  const left = shingles(a, size)
  const right = shingles(b, size)
  if (left.size === 0 || right.size === 0) return 0

  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  let shared = 0
  for (const shingle of small) if (large.has(shingle)) shared += 1
  return shared / small.size
}

/** Od této podobnosti považujeme materiály za tentýž obsah. */
export const DUPLICATE_THRESHOLD = 0.6

/**
 * Který ze dvou materiálů se stejným obsahem si ponechat.
 * Prezentace nese poznámky přednášejícího, které v PDF exportu chybí,
 * jinak rozhoduje delší text.
 */
const FORMAT_RANK: Record<string, number> = {
  odp: 5,
  odt: 4,
  docx: 4,
  ods: 3,
  html: 2,
  pdf: 1,
  txt: 1,
  md: 1,
}

export function preferredMaterial<T extends { extension: string; textLength: number }>(
  a: T,
  b: T,
): T {
  const rankA = FORMAT_RANK[a.extension] ?? 0
  const rankB = FORMAT_RANK[b.extension] ?? 0
  if (rankA !== rankB) return rankA > rankB ? a : b
  return a.textLength >= b.textLength ? a : b
}
