import type { Question, QuestionType } from '../schema/question'
import { hashSeed, seededRandom, shuffled } from '../pdf/shuffle'

/**
 * Náhodné poskládání písemky z banky otázek.
 *
 * Čistá funkce bez Reactu a bez databáze: vstupem je seznam otázek a zadání,
 * výstupem vybrané otázky. Rozhraní ji volá v prohlížeči, ale stejně tak po ní
 * může sáhnout CLI nebo budoucí agent.
 *
 * Losování je řízené seedem, takže totéž zadání dá vždycky týž test —
 * „Zamíchat znovu“ v rozhraní není nic jiného než nový seed.
 */

/** Obtížnost v zadání; `mix` znamená „na obtížnosti nezáleží“. */
export type DifficultyChoice = 1 | 2 | 3 | 'mix'

/** Čím je rozsah testu daný: počtem otázek, nebo celkovým počtem bodů. */
export type RandomTestLimit =
  | { kind: 'count'; count: number }
  | { kind: 'points'; points: number }

export interface RandomTestRequest {
  /** Témata, ze kterých se losuje. Prázdné (nebo chybí) = všechna dodaná. */
  topicIds?: string[]
  limit: RandomTestLimit
  /** Povolené typy otázek; prázdné (nebo chybí) = všechny. */
  types?: QuestionType[]
  difficulty?: DifficultyChoice
  /** Jen schválené otázky — do ostré písemky nemá proklouznout koncept. */
  onlyApproved?: boolean
  /** Cokoli, co jde zapsat; stejný seed = stejný výběr. */
  seed: string
}

/** Kolik otázek na téma vyšlo a kolik jich vůbec bylo k dispozici. */
export interface RandomTestTopicShare {
  /** `null` u otázek bez tématu. */
  topicId: string | null
  picked: number
  available: number
}

export interface RandomTestResult {
  /** Vybrané otázky v pořadí, v jakém mají jít do osnovy. */
  questions: Question[]
  totalPoints: number
  /** Rozdělení podle témat — rozhraní k nim doplní názvy. */
  topics: RandomTestTopicShare[]
  /**
   * Kolik chybí do zadání: u počtu otázek počet otázek, u bodů body.
   * Nula znamená, že zadání vyšlo.
   */
  shortfall: number
  /** Vysvětlení pro učitelku, česky; prázdné, když není co vysvětlovat. */
  notes: string[]
}

/** Klíč přihrádky pro otázky bez tématu; id z databáze takhle nevypadá. */
const NO_TOPIC = '__bez-tematu__'

/** Body s desetinnou čárkou podle českého úzu. */
function formatPoints(points: number): string {
  return Number.isInteger(points) ? String(points) : points.toFixed(1).replace('.', ',')
}

/** Projde otázka filtry zadání? */
function matches(question: Question, request: RandomTestRequest, topicFilter: Set<string> | null): boolean {
  if (topicFilter && !(question.topicId && topicFilter.has(question.topicId))) return false
  if (request.onlyApproved && question.status !== 'approved') return false
  if (request.types && request.types.length > 0 && !request.types.includes(question.type)) return false
  const difficulty = request.difficulty ?? 'mix'
  if (difficulty !== 'mix' && question.difficulty !== difficulty) return false
  return true
}

/**
 * Vybere otázky podle zadání.
 *
 * Rozprostření: losuje se po kolech přes témata (round robin), takže při
 * čtyřech tématech a deseti otázkách padnou na každé téma dvě až tři, ne
 * deset z jednoho. Uvnitř tématu dostane přednost otázka typu, kterého je
 * zatím ve výběru nejmíň — tím se rozprostřou i typy. Když téma dojde,
 * kolo ho jen přeskočí a zbytek doberou ostatní.
 */
export function composeRandomTest(questions: Question[], request: RandomTestRequest): RandomTestResult {
  const topicFilter = request.topicIds && request.topicIds.length > 0 ? new Set(request.topicIds) : null
  const rand = seededRandom(hashSeed(request.seed))

  // Přihrádky podle témat. Otázky se řadí podle id, ať výsledek nezáleží na
  // pořadí, v jakém je dodala databáze; teprve pak se míchají seedem.
  const pools = new Map<string, Question[]>()
  for (const question of questions) {
    if (!matches(question, request, topicFilter)) continue
    const key = question.topicId ?? NO_TOPIC
    const pool = pools.get(key)
    if (pool) pool.push(question)
    else pools.set(key, [question])
  }
  // Míchá se v pořadí podle klíče tématu, ne podle toho, které téma přišlo
  // z databáze první — jinak by se losování rozešlo při jiném řazení dotazu.
  for (const key of [...pools.keys()].sort()) {
    const pool = pools.get(key) as Question[]
    pools.set(key, shuffled([...pool].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), rand))
  }

  // Prázdná témata musí být ve výsledku vidět, i když z nich nic nevyšlo —
  // jinak učitelka nepozná, proč jich v testu je míň, než zaškrtla.
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
   * Nejlepší dosud nepoužitá otázka tématu: nejdřív ta, která u bodového
   * zadání cíl nepřestřelí, pak typ, kterého je ve výběru zatím nejmíň.
   * Při shodě rozhoduje pořadí losu.
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
      // U bodového zadání má přednost otázka, která cíl nepřestřelí; jinak by
      // se na konec vlezla otázka za pět bodů kvůli jedinému chybějícímu.
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
    // Vybraná otázka se vymění s první nepoužitou a kurzor se posune — pole
    // tak zůstane bez děr a další kolo bere zas od kurzoru.
    pool[index] = pool[from] as Question
    pool[from] = question
    cursors.set(key, from + 1)

    picked.push(question)
    totalPoints += question.points
    typeUsage.set(question.type, (typeUsage.get(question.type) ?? 0) + 1)
    pickedPerTopic.set(key, (pickedPerTopic.get(key) ?? 0) + 1)
  }

  // Kolo = každé téma nejvýš jednou, takže se počty mezi tématy nerozjedou.
  // Na kterém tématu je uvnitř kola řada, se ale rozhoduje až podle typů:
  // přednost má téma, které umí nabídnout typ zastoupený zatím nejmíň.
  // Kdyby se v kole chodilo napevno podle pořadí, poslední otázka kola by
  // padla na téma, kterému chybějící typ mezitím došel, a typy by se rozešly.
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
        ? `Vyhovujících otázek je jen ${picked.length} z požadovaných ${target.count}. Vloží se, co je — zbytek přidej ručně, nebo povol víc témat a typů.`
        : `Dohromady to dá ${formatPoints(totalPoints)} b. místo požadovaných ${formatPoints(target.points)} b. Víc vyhovujících otázek ve vybraných tématech není.`,
    )
  }
  const empty = topics.filter((topic) => topic.available === 0).length
  if (empty > 0) {
    notes.push(
      empty === 1
        ? 'Jedno vybrané téma nemá žádnou otázku, která by prošla filtry.'
        : `Vybraná témata bez jediné vyhovující otázky: ${empty}.`,
    )
  }
  if (picked.length === 0) {
    notes.push(
      'Filtrům nevyhovuje ani jedna otázka. Zkus povolit víc typů, jinou obtížnost, nebo i neschválené otázky.',
    )
  }

  return { questions: picked, totalPoints, topics, shortfall, notes }
}

/** Nový seed pro losování — krátký, aby se dal přečíst i opsat. */
export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 8)
}
