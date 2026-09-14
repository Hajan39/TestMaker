/**
 * Slučování souborů do jednoho tématu. Jedno téma = skupina materiálů,
 * ze které se generuje dohromady — jediný soubor často na celou písemku nestačí
 * a z několika zvlášť generovaných běhů vznikají duplicitní otázky.
 */

/** Slova, která o obsahu nic neříkají a při porovnání názvů se vynechávají. */
const STOPWORDS = new Set([
  'test',
  'testy',
  'pl',
  'pracovni',
  'list',
  'listy',
  'prezentace',
  'zapis',
  'zapisy',
  'reseni',
  'web',
  'final',
  'kopie',
  'novy',
  'nova',
  'a',
  'i',
  'do',
  'na',
  'v',
  've',
  'z',
  'ze',
  'k',
  'ke',
  'o',
  'pro',
  'se',
])

/** Významová slova názvu tématu bez diakritiky, čísel a balastu. */
export function topicTokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !/^\d+$/.test(token) && !STOPWORDS.has(token))
}

/**
 * Patří dva názvy k témuž tématu? Platí, když jsou významová slova kratšího
 * názvu obsažena v delším — „Měkkýši“ a „Měkkýši (Mollusca) – PLŽI, MLŽI“
 * jsou jedno téma, „Buňka“ a „Buňky a tkáně“ nikoli.
 */
export function sameTopic(a: string, b: string): boolean {
  const left = topicTokens(a)
  const right = topicTokens(b)
  if (left.length === 0 || right.length === 0) return false

  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left]
  const longerSet = new Set(longer)
  return shorter.every((token) => longerSet.has(token))
}

/**
 * Najde mezi existujícími tématy to, se kterým se nový název slučuje.
 *
 * Když název odpovídá několika tématům, která spolu navzájem nesouvisejí,
 * jde o obecný nadpis („mineralogická třída“ sedí na sulfidy, halogenidy
 * i oxidy) — takový název vlastní skupinu nezakládá ani nespojuje cizí lekce
 * a vrací se `null`.
 */
export function findMatchingTopic<T extends { name: string }>(
  candidates: T[],
  name: string,
): T | null {
  const tokens = topicTokens(name)
  if (tokens.length === 0) return null

  const matches = candidates.filter((candidate) => sameTopic(candidate.name, name))
  if (matches.length === 0) return null

  if (matches.length > 1) {
    const mutuallyRelated = matches.every((a, i) =>
      matches.every((b, j) => i === j || sameTopic(a.name, b.name)),
    )
    if (!mutuallyRelated) return null
  }

  return matches.reduce((best, candidate) => {
    const distance = Math.abs(topicTokens(candidate.name).length - tokens.length)
    const bestDistance = Math.abs(topicTokens(best.name).length - tokens.length)
    return distance < bestDistance ? candidate : best
  })
}

/** Kratší z názvů je srozumitelnější jako název skupiny. */
export function preferredTopicName(a: string, b: string): string {
  const tokensA = topicTokens(a).length
  const tokensB = topicTokens(b).length
  if (tokensA !== tokensB) return tokensA < tokensB ? a : b
  return a.length <= b.length ? a : b
}
