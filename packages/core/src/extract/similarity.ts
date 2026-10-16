/**
 * Detecting the same content in two materials. Typical case: an `.odp`
 * presentation and its PDF export lie in the same folder and carry the same text.
 */

/** All words without diacritics, punctuation and case. */
function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Words longer than one letter. */
function tokenize(text: string): string[] {
  return words(text).filter((token) => token.length > 1)
}

/**
 * Function words of question prompts, without diacritics (as `tokenize`
 * returns them). They say how something is asked, not what — two questions
 * "Jak se nazývá…" about different facts must not look alike because of
 * them. Words shorter than three letters are dropped anyway.
 */
const QUESTION_STOP_WORDS = new Set([
  'jak', 'jaky', 'jaka', 'jake', 'jakou', 'jakem', 'jakych', 'ktery', 'ktera', 'ktere', 'kteri', 'kterou',
  'kterem', 'kterym', 'kterych', 'ktereho', 'proc', 'kde', 'kdy', 'kdo', 'kolik', 'odkud', 'kam', 'coz', 'ten',
  'tento', 'tato', 'toto', 'tyto', 'techto', 'teto', 'tohoto', 'tim', 'jsou', 'byl', 'byla', 'bylo', 'byly',
  'jeho', 'jeji', 'jejich', 'pro', 'pri', 'pod', 'nad', 'mezi', 'podle', 'jako', 'nebo', 'ale', 'take', 'tak',
  'aby', 'zda', 'nazyva', 'nazyvame', 'nazyvaji', 'jmenuje', 'oznacujeme', 'rikame', 'vyber', 'vyberte', 'oznac',
  'spravnou', 'spravne', 'spravny', 'spravneho', 'moznost', 'moznosti', 'rozhodni', 'tvrzeni', 'pravdiva',
  'dopln', 'chybejici', 'vyrazy', 'prirad', 'sobe', 'odpovidajici', 'dvojice', 'serad', 'poradi', 'vysvetli',
  'popis', 'uved', 'napis', 'nakresli', 'jednu', 'vsechny',
])

/**
 * Content words of a short text (a question with its answer): no diacritics,
 * no short or function words. Numbers stay whatever their length — a year or
 * a count is often the whole answer.
 */
export function contentWords(text: string): string[] {
  const kept = words(text).filter(
    (word) => /\d/.test(word) || (word.length >= 3 && !QUESTION_STOP_WORDS.has(word)),
  )
  return [...new Set(kept)]
}

/**
 * Two word forms count as one word when they share a prefix — Czech
 * inflection changes word endings ("fotosyntéza", "fotosyntéze", "voda",
 * "vody"). The prefix is the shorter word minus its last letter, at least
 * three and at most five letters. Numbers must match exactly — 1348 and
 * 1349 are different answers.
 */
function sameWord(a: string, b: string): boolean {
  if (/\d/.test(a) || /\d/.test(b)) return a === b
  const length = Math.max(3, Math.min(5, Math.min(a.length, b.length) - 1))
  return a.slice(0, length) === b.slice(0, length)
}

/**
 * Word overlap of two `contentWords` lists, 0–1: the average of the share of
 * words of each list found in the other. Symmetric on purpose — a short
 * question about one term must not count as a copy of every longer question
 * that mentions the term in passing.
 */
export function wordSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const covered = (from: string[], to: string[]) =>
    from.filter((word) => to.some((other) => sameWord(word, other))).length / from.length
  return (covered(a, b) + covered(b, a)) / 2
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
