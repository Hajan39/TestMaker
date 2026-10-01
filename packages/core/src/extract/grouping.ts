/**
 * Merging files into one topic. One topic = a group of materials generated
 * from together — a single file is often not enough for a whole test, and
 * several separately generated runs produce duplicate questions.
 */

/** Words that say nothing about the content and are skipped when comparing names. */
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

/** Meaningful words of a topic name without diacritics, numbers and filler. */
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
 * Delimiters at which a name breaks into separate segments (e.g. "Měkkýši
 * (Mollusca) – PLŽI, MLŽI" into "Měkkýši", "Mollusca", "PLŽI", "MLŽI").
 */
const SEGMENT_DELIMITERS = /[-–—(),:;/_]+/g

/** Meaningful words of each segment of a name split by a dash, parenthesis etc. */
function nameSegments(name: string): string[][] {
  return name.split(SEGMENT_DELIMITERS).map(topicTokens)
}

function sameTokenSet(a: string[], b: Set<string>): boolean {
  return a.length === b.size && a.every((token) => b.has(token))
}

/**
 * Do two names belong to the same topic?
 *
 * It is not enough that the meaningful words of the shorter name are a subset
 * of the longer one — "Rostliny" is a subset of "Výtrusné rostliny", and yet
 * they are two different lessons (7.11 vs. 7.13), whereas "Rostliny" and
 * "7.11 Rostliny prezentace" are the same material. The difference is WHERE
 * the shared word sits in the longer name: as a whole segment bounded by
 * delimiters (dash, parenthesis, comma) it is an addition/apposition to the
 * same topic ("Měkkýši (Mollusca) – PLŽI…", "Poznávačka – ryby"); but when it
 * is attached to another word without a delimiter ("Výtrusné rostliny",
 * "vyšší rostliny"), it is an adjective that turns the general name into a
 * different, narrower subject, and must not be merged.
 */
export function sameTopic(a: string, b: string): boolean {
  const left = topicTokens(a)
  const right = topicTokens(b)
  if (left.length === 0 || right.length === 0) return false

  // The same words in a different order (a rephrased name) are always the same topic.
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
 * Finds among existing topics the one the new name merges with.
 *
 * When the name matches several topics that are not related to each other,
 * it is a generic heading ("mineralogická třída" fits sulfides, halides and
 * oxides) — such a name neither founds its own group nor joins unrelated
 * lessons, and `null` is returned.
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

/** The shorter of the names is clearer as the group name. */
export function preferredTopicName(a: string, b: string): string {
  const tokensA = topicTokens(a).length
  const tokensB = topicTokens(b).length
  if (tokensA !== tokensB) return tokensA < tokensB ? a : b
  return a.length <= b.length ? a : b
}

/** Placement of a material in the library: subject → grade → topic. */
export interface Placement {
  subject: string
  grade: string | null
  topic: string
}

/**
 * Group of files that end up in one topic on import.
 * `grade` is an empty string, not null, so it can go straight into an input;
 * an empty subject means nothing could be read from the path and the teacher
 * fills it in.
 */
export interface ImportGroup<T> {
  id: string
  subject: string
  grade: string
  topic: string
  files: T[]
}

/** Name `parsePath` uses when no subject can be read from the path (stored data). */
export const UNPLACED_SUBJECT = 'Nezařazeno'

/**
 * Groups the guessed placements for the preview before import.
 *
 * Does as a dry run the same thing the server will do: within one subject and
 * grade it joins files whose names belong to the same topic ("Měkkýši" and
 * "6.22 Měkkýši (Mollusca)") and keeps the clearer name for the group. The
 * teacher thus sees real groups in the preview, not a list of files.
 *
 * The subject "Nezařazeno" (a single file without a folder) becomes empty —
 * such groups go first in the list, because without being filled in they
 * would not be saved where the teacher expects.
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

  // Unplaced first: those are the ones waiting to be filled in.
  return [...groups].sort((a, b) => {
    if (!a.subject !== !b.subject) return a.subject ? 1 : -1
    return (
      a.subject.localeCompare(b.subject, 'cs') ||
      a.grade.localeCompare(b.grade, 'cs') ||
      a.topic.localeCompare(b.topic, 'cs')
    )
  })
}
