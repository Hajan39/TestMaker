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
 * Oddělovače, na kterých se název láme na samostatné úseky (např. „Měkkýši
 * (Mollusca) – PLŽI, MLŽI“ na „Měkkýši“, „Mollusca“, „PLŽI“, „MLŽI“).
 */
const SEGMENT_DELIMITERS = /[-–—(),:;/_]+/g

/** Významová slova jednotlivých úseků názvu odděleného pomlčkou, závorkou apod. */
function nameSegments(name: string): string[][] {
  return name.split(SEGMENT_DELIMITERS).map(topicTokens)
}

function sameTokenSet(a: string[], b: Set<string>): boolean {
  return a.length === b.size && a.every((token) => b.has(token))
}

/**
 * Patří dva názvy k témuž tématu?
 *
 * Nestačí, že významová slova kratšího názvu jsou podmnožinou delšího —
 * „Rostliny“ je podmnožinou „Výtrusné rostliny“, a přesto jde o dvě různé
 * lekce (7.11 vs. 7.13), zatímco „Rostliny“ a „7.11 Rostliny prezentace“
 * je tentýž materiál. Rozdíl je v tom, KDE se to shodné slovo v delším
 * názvu nachází: jako celý, oddělovači (pomlčka, závorka, čárka) ohraničený
 * úsek jde o doplněk/apozici k témuž tématu („Měkkýši (Mollusca) – PLŽI…“,
 * „Poznávačka – ryby“); je-li ale přilepené k jinému slovu bez oddělovače
 * („Výtrusné rostliny“, „vyšší rostliny“), jde o přídavné jméno, které dělá
 * z obecného názvu jinou, užší látku, a slučovat se nesmí.
 */
export function sameTopic(a: string, b: string): boolean {
  const left = topicTokens(a)
  const right = topicTokens(b)
  if (left.length === 0 || right.length === 0) return false

  // Stejná slova v jiném pořadí (přeformulovaný název) jsou vždy totéž téma.
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (sameTokenSet(right, leftSet)) return true

  const leftIsShorter = left.length <= right.length
  const shorterTokens = leftIsShorter ? left : right
  const longerName = leftIsShorter ? b : a
  const longerSet = leftIsShorter ? rightSet : leftSet
  if (!shorterTokens.every((token) => longerSet.has(token))) return false

  const shorterSet = new Set(shorterTokens)
  return nameSegments(longerName).some((segment) => sameTokenSet(segment, shorterSet))
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

/** Zařazení materiálu v knihovně: předmět → ročník → téma. */
export interface Placement {
  subject: string
  grade: string | null
  topic: string
}

/**
 * Skupina souborů, které při importu spadnou do jednoho tématu.
 * `grade` je prázdný řetězec, ne null, aby se dal rovnou psát do políčka;
 * prázdný předmět znamená, že z cesty nešlo nic vyčíst a učitelka ho doplní.
 */
export interface ImportGroup<T> {
  id: string
  subject: string
  grade: string
  topic: string
  files: T[]
}

/** Název, který `parsePath` použije, když z cesty předmět vyčíst nejde. */
export const UNPLACED_SUBJECT = 'Nezařazeno'

/**
 * Seskupí odhadnutá zařazení do skupin pro náhled před importem.
 *
 * Dělá nanečisto totéž, co pak udělá server: v rámci jednoho předmětu a
 * ročníku spojí soubory, jejichž názvy patří k témuž tématu („Měkkýši“ a
 * „6.22 Měkkýši (Mollusca)“), a skupině nechá ten srozumitelnější název.
 * Díky tomu učitelka v náhledu vidí skutečné skupiny, ne seznam souborů.
 *
 * Předmět „Nezařazeno“ (samostatný soubor bez složky) se převede na prázdný —
 * takové skupiny jdou v seznamu první, protože se bez doplnění neuloží tam,
 * kam učitelka čeká.
 */
export function groupForImport<T extends Placement>(items: T[]): ImportGroup<T>[] {
  const groups: ImportGroup<T>[] = []

  for (const item of items) {
    const subject = item.subject.trim() === UNPLACED_SUBJECT ? '' : item.subject.trim()
    const grade = (item.grade ?? '').trim()
    const topic = item.topic.trim()

    const siblings = groups.filter((group) => group.subject === subject && group.grade === grade)
    const exact = siblings.find((group) => group.topic === topic)
    if (exact) {
      exact.files.push(item)
      continue
    }

    const match = findMatchingTopic(
      siblings.map((group) => ({ name: group.topic, group })),
      topic,
    )
    if (match) {
      match.group.topic = preferredTopicName(match.group.topic, topic)
      match.group.files.push(item)
      continue
    }

    groups.push({ id: `skupina-${groups.length + 1}`, subject, grade, topic, files: [item] })
  }

  // Nezařazené napřed: právě ty čekají na doplnění.
  return [...groups].sort((a, b) => {
    if (!a.subject !== !b.subject) return a.subject ? 1 : -1
    return (
      a.subject.localeCompare(b.subject, 'cs') ||
      a.grade.localeCompare(b.grade, 'cs') ||
      a.topic.localeCompare(b.topic, 'cs')
    )
  })
}
