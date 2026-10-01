import { t } from '../i18n'
import type { Question, QuestionType } from '../schema/question'
import { hashSeed, seededRandom, shuffled } from '../pdf/shuffle'

/**
 * Random composition of a test from the question bank.
 *
 * A pure function without React or a database: the input is a list of
 * questions and a request, the output the picked questions. The UI calls it in
 * the browser, but a CLI or a future agent can use it just as well.
 *
 * Drawing is seed driven, so the same request always yields the same test —
 * „Zamíchat znovu“ in the UI is nothing more than a new seed.
 */

/** Requested difficulty; `mix` means "difficulty does not matter". */
export type DifficultyChoice = 1 | 2 | 3 | 'mix'

/** What sets the test size: a question count or a total point count. */
export type RandomTestLimit =
  | { kind: 'count'; count: number }
  | { kind: 'points'; points: number }

export interface RandomTestRequest {
  /** Topics to draw from. Empty (or missing) = all supplied. */
  topicIds?: string[]
  limit: RandomTestLimit
  /** Allowed question types; empty (or missing) = all. */
  types?: QuestionType[]
  difficulty?: DifficultyChoice
  /** Approved questions only — a draft must not slip into a real test. */
  onlyApproved?: boolean
  /** Anything writable; same seed = same selection. */
  seed: string
}

/** How many questions a topic got and how many were available at all. */
export interface RandomTestTopicShare {
  /** `null` for questions without a topic. */
  topicId: string | null
  picked: number
  available: number
}

export interface RandomTestResult {
  /** Picked questions in the order they go into the outline. */
  questions: Question[]
  totalPoints: number
  /** Breakdown by topic — the UI adds the names. */
  topics: RandomTestTopicShare[]
  /**
   * How much is missing from the request: questions for a count, points for
   * points. Zero means the request was met.
   */
  shortfall: number
  /** Explanations for the teacher; empty when there is nothing to explain. */
  notes: string[]
}

/** Bucket key for questions without a topic; no database id looks like this. */
const NO_TOPIC = '__no-topic__'

/** Points with a decimal comma per Czech convention. */
function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1).replace('.', ',')
}

/** Does the question pass the request filters? */
function matches(question: Question, request: RandomTestRequest, topicFilter: Set<string> | null): boolean {
  if (topicFilter && !(question.topicId && topicFilter.has(question.topicId))) return false
  if (request.onlyApproved && question.status !== 'approved') return false
  if (request.types && request.types.length > 0 && !request.types.includes(question.type)) return false
  const difficulty = request.difficulty ?? 'mix'
  if (difficulty !== 'mix' && question.difficulty !== difficulty) return false
  return true
}

/**
 * Picks questions according to the request.
 *
 * Spreading: drawing goes in rounds across topics (round robin), so with four
 * topics and ten questions each topic gets two or three, not ten from one.
 * Within a topic, a question of the type least represented so far wins — that
 * spreads types too. When a topic runs out, the round just skips it and the
 * others make up the rest.
 */
export function composeRandomTest(questions: Question[], request: RandomTestRequest): RandomTestResult {
  const topicFilter = request.topicIds && request.topicIds.length > 0 ? new Set(request.topicIds) : null
  const rand = seededRandom(hashSeed(request.seed))

  // Buckets by topic. Questions are sorted by id so the result does not depend
  // on the order the database returned them in; only then are they shuffled.
  const pools = new Map<string, Question[]>()
  for (const question of questions) {
    if (!matches(question, request, topicFilter)) continue
    const key = question.topicId ?? NO_TOPIC
    const pool = pools.get(key)
    if (pool) pool.push(question)
    else pools.set(key, [question])
  }
  // Shuffle in topic key order, not in the order topics came from the
  // database — otherwise a different query ordering would change the draw.
  for (const key of [...pools.keys()].sort()) {
    const pool = pools.get(key) as Question[]
    pools.set(key, shuffled([...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), rand))
  }

  // Empty topics must show in the result even when nothing came from them —
  // otherwise the teacher cannot tell why the test has fewer than she ticked.
  const requested = request.topicIds && request.topicIds.length > 0 ? [...new Set(request.topicIds)] : [...pools.keys()]
  const available = new Map<string, number>()
  for (const key of requested) available.set(key, pools.get(key)?.length ?? 0)
  for (const [key, pool] of pools) if (!available.has(key)) available.set(key, pool.length)

  const order = shuffled([...available.keys()].sort(), rand)
  const cursors = new Map<string, number>(order.map((key) => [key, 0]))
  const typeUsage = new Map<QuestionType, number>()
  const picked: Question[] = []
  const pickedPerTopic = new Map<string, number>()
  let totalPoints = 0

  const target = request.limit
  const done = () => (target.kind === 'count' ? picked.length >= target.count : totalPoints >= target.points)

  /**
   * Best unused question of a topic: first one that does not overshoot a
   * points target, then the type least represented so far. Ties are broken by
   * draw order.
   */
  function bestCandidate(key: string): { index: number; score: [number, number] } | null {
    const pool = pools.get(key)
    if (!pool) return null
    const from = cursors.get(key) ?? 0
    if (from >= pool.length) return null

    const remaining = target.kind === 'points' ? target.points - totalPoints : 0
    let bestIndex = -1
    let bestScore: [number, number] | null = null
    for (let i = from; i < pool.length; i += 1) {
      const question = pool[i] as Question
      // For a points target, a question that does not overshoot wins; otherwise
      // a five-point question would be squeezed in for a single missing point.
      const overshoot = target.kind === 'points' && question.points > remaining ? 1 : 0
      const score: [number, number] = [overshoot, typeUsage.get(question.type) ?? 0]
      if (!bestScore || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
        bestIndex = i
        bestScore = score
        if (score[0] === 0 && score[1] === 0) break
      }
    }
    return bestIndex === -1 || !bestScore ? null : { index: bestIndex, score: bestScore }
  }

  function commit(key: string, index: number): void {
    const pool = pools.get(key) as Question[]
    const from = cursors.get(key) ?? 0
    const question = pool[index] as Question
    // Swap the picked question with the first unused one and advance the
    // cursor — the array stays hole-free and the next round starts at the cursor.
    pool[index] = pool[from] as Question
    pool[from] = question
    cursors.set(key, from + 1)

    picked.push(question)
    totalPoints += question.points
    typeUsage.set(question.type, (typeUsage.get(question.type) ?? 0) + 1)
    pickedPerTopic.set(key, (pickedPerTopic.get(key) ?? 0) + 1)
  }

  // A round = each topic at most once, so counts across topics stay even.
  // Which topic goes next within a round is decided by types: the topic that
  // can offer the least represented type wins. With a fixed order, the last
  // question of a round would fall on a topic that has run out of the missing
  // type, and types would drift apart.
  while (!done()) {
    const pending = new Set(order.filter((key) => (cursors.get(key) ?? 0) < (pools.get(key)?.length ?? 0)))
    if (pending.size === 0) break

    while (pending.size > 0 && !done()) {
      let bestKey: string | null = null
      let bestScore: [number, number] | null = null
      let bestIndex = -1
      for (const key of order) {
        if (!pending.has(key)) continue
        const candidate = bestCandidate(key)
        if (!candidate) {
          pending.delete(key)
          continue
        }
        const { score } = candidate
        if (!bestScore || score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
          bestKey = key
          bestScore = score
          bestIndex = candidate.index
        }
      }
      if (bestKey === null) break
      commit(bestKey, bestIndex)
      pending.delete(bestKey)
    }
  }

  const topics: RandomTestTopicShare[] = [...available.entries()]
    .map(([key, count]) => ({
      topicId: key === NO_TOPIC ? null : key,
      picked: pickedPerTopic.get(key) ?? 0,
      available: count,
    }))
    .sort((a, b) => b.picked - a.picked)

  const shortfall =
    target.kind === 'count'
      ? Math.max(0, target.count - picked.length)
      : Math.max(0, target.points - totalPoints)

  const notes: string[] = []
  if (shortfall > 0 && picked.length > 0) {
    notes.push(
      target.kind === 'count'
        ? t('pdf:compose.countShortfall', { picked: picked.length, requested: target.count })
        : t('pdf:compose.pointsShortfall', { points: formatPoints(totalPoints), requested: formatPoints(target.points) }),
    )
  }
  const empty = topics.filter((topic) => topic.available === 0).length
  if (empty > 0) {
    notes.push(
      empty === 1
        ? t('pdf:compose.oneEmptyTopic')
        : t('pdf:compose.emptyTopics', { n: empty }),
    )
  }
  if (picked.length === 0) {
    notes.push(
      t('pdf:compose.nothingMatches'),
    )
  }

  return { questions: picked, totalPoints, topics, shortfall, notes }
}

/** New draw seed — short, so it can be read and copied by hand. */
export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8)
}
