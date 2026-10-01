/**
 * Detecting the same content in two materials. Typical case: an `.odp`
 * presentation and its PDF export lie in the same folder and carry the same text.
 */

/** Words without diacritics, punctuation and case. */
function tokenize(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1)
}

/** Set of n-grams (4 words by default) — robust against reordered paragraphs. */
export function shingles(text: string, size = 4): Set<string> {
  const tokens = tokenize(text)
  const result = new Set<string>()
  for (let i = 0; i + size <= tokens.length; i += 1) {
    result.add(tokens.slice(i, i + size).join(' '))
  }
  return result
}

/**
 * Share of common n-grams relative to the smaller of the documents.
 * Unlike Jaccard it also detects the case where one version additionally
 * contains speaker notes and yet it is the same material.
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

/** From this similarity on, materials are considered the same content. */
export const DUPLICATE_THRESHOLD = 0.6

/**
 * Which of two materials with the same content to keep.
 * A presentation carries speaker notes missing from the PDF export;
 * otherwise the longer text wins.
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
