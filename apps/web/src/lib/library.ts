import 'server-only'
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { findMatchingTopic, preferredTopicName } from '@testmaker/core/extract'
import { db, generationJobs, grades, materials, questions, subjects, topics } from '@/db'
import { skola, type Scope } from './uzivatel'
import { newId } from './ids'

/**
 * Knihovna je společná pro celou školu, ale nikdy ne napříč školami. Rozsah
 * proto chodí jako první parametr každé funkce v tomhle modulu: kdo ho
 * zapomene předat, neprojde překladem.
 */

export interface TopicNode {
  id: string
  name: string
  materialCount: number
  /** Otázky tématu kromě smazaných — smazaná karta se do počtu nepočítá. */
  questionCount: number
  /** Použitelného textu (bez duplicit) je málo na písemku — viz `MIN_USABLE_TOPIC_CHARS`. */
  lowContent: boolean
}

export interface GradeNode {
  id: string
  name: string
  topics: TopicNode[]
}

export interface SubjectNode {
  id: string
  name: string
  grades: GradeNode[]
}

/** Celý strom Předmět → Ročník → Téma s počty materiálů a otázek. */
export async function loadLibraryTree(scope: Scope): Promise<SubjectNode[]> {
  const [subjectRows, gradeRows, topicRows, materialCounts, questionCounts] = await Promise.all([
    db
      .select()
      .from(subjects)
      .where(skola(scope, subjects))
      .orderBy(asc(subjects.position), asc(subjects.name)),
    db
      .select()
      .from(grades)
      .where(skola(scope, grades))
      .orderBy(asc(grades.position), asc(grades.name)),
    db
      .select()
      .from(topics)
      .where(skola(scope, topics))
      .orderBy(asc(topics.position), asc(topics.name)),
    db
      .select({ topicId: materials.topicId, value: count() })
      .from(materials)
      .where(skola(scope, materials))
      .groupBy(materials.topicId),
    db
      .select({
        topicId: questions.topicId,
        // Smazané (rejected) se do počtu nepočítají — karta u nich stejně
        // zmizí, takže by číslo nahoře lhalo.
        total: sql<number>`sum(case when ${questions.status} != 'rejected' then 1 else 0 end)`,
      })
      .from(questions)
      .where(skola(scope, questions))
      .groupBy(questions.topicId),
  ])

  const materialsByTopic = new Map(materialCounts.map((row) => [row.topicId, row.value]))
  const questionsByTopic = new Map(questionCounts.map((row) => [row.topicId, row]))

  const topicsByGrade = new Map<string, TopicNode[]>()
  for (const topic of topicRows) {
    const stats = questionsByTopic.get(topic.id)
    const list = topicsByGrade.get(topic.gradeId) ?? []
    list.push({
      id: topic.id,
      name: topic.name,
      materialCount: materialsByTopic.get(topic.id) ?? 0,
      questionCount: Number(stats?.total ?? 0),
      lowContent: topic.lowContent,
    })
    topicsByGrade.set(topic.gradeId, list)
  }

  const gradesBySubject = new Map<string, GradeNode[]>()
  for (const grade of gradeRows) {
    const list = gradesBySubject.get(grade.subjectId) ?? []
    list.push({ id: grade.id, name: grade.name, topics: topicsByGrade.get(grade.id) ?? [] })
    gradesBySubject.set(grade.subjectId, list)
  }

  return subjectRows.map((subject) => ({
    id: subject.id,
    name: subject.name,
    grades: gradesBySubject.get(subject.id) ?? [],
  }))
}

/** Stav generování tématu ve frontě — jen to, co stránka třídy potřebuje ukázat. */
export type TopicJobState = 'queued' | 'running' | null

export interface ClassTopicNode extends TopicNode {
  jobState: TopicJobState
}

export interface ClassInfo {
  gradeId: string
  gradeName: string
  subjectId: string
  subjectName: string
  topics: ClassTopicNode[]
}

/**
 * Data stránky třídy: název třídy (předmět + ročník) a jeho témata i s
 * počty a stavem generování. Cizí nebo neexistující ročník vrací `null` —
 * stránka na to odpoví `notFound()`, ne chybou.
 */
export async function loadClassTopics(scope: Scope, gradeId: string): Promise<ClassInfo | null> {
  const [grade] = await db
    .select({ id: grades.id, name: grades.name, subjectId: grades.subjectId, subjectName: subjects.name })
    .from(grades)
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(skola(scope, grades), eq(grades.id, gradeId)))
    .limit(1)
  if (!grade) return null

  const topicRows = await db
    .select({ id: topics.id, name: topics.name, lowContent: topics.lowContent })
    .from(topics)
    .where(and(skola(scope, topics), eq(topics.gradeId, gradeId)))
    .orderBy(asc(topics.position), asc(topics.name))
  const topicIds = topicRows.map((topic) => topic.id)

  const [materialCounts, questionCounts, jobRows] = await Promise.all([
    topicIds.length
      ? db
          .select({ topicId: materials.topicId, value: count() })
          .from(materials)
          .where(and(skola(scope, materials), inArray(materials.topicId, topicIds)))
          .groupBy(materials.topicId)
      : Promise.resolve([]),
    topicIds.length
      ? db
          .select({
            topicId: questions.topicId,
            total: sql<number>`sum(case when ${questions.status} != 'rejected' then 1 else 0 end)`,
          })
          .from(questions)
          .where(and(skola(scope, questions), inArray(questions.topicId, topicIds)))
          .groupBy(questions.topicId)
      : Promise.resolve([]),
    topicIds.length
      ? db
          .select({ topicId: generationJobs.topicId, status: generationJobs.status })
          .from(generationJobs)
          .where(
            and(
              skola(scope, generationJobs),
              inArray(generationJobs.topicId, topicIds),
              inArray(generationJobs.status, ['queued', 'running']),
            ),
          )
      : Promise.resolve([]),
  ])

  const materialsByTopic = new Map(materialCounts.map((row) => [row.topicId, row.value]))
  const questionsByTopic = new Map(questionCounts.map((row) => [row.topicId, Number(row.total)]))

  // Běžící úloha má přednost před čekající, kdyby snad obojí ukazovalo na
  // totéž téma — ale i to čekající se počítá, dokud nic neběží.
  const jobByTopic = new Map<string, TopicJobState>()
  for (const job of jobRows) {
    if (job.status === 'running' || jobByTopic.get(job.topicId) !== 'running') {
      jobByTopic.set(job.topicId, job.status as TopicJobState)
    }
  }

  return {
    gradeId: grade.id,
    gradeName: grade.name,
    subjectId: grade.subjectId,
    subjectName: grade.subjectName,
    topics: topicRows.map((topic) => ({
      id: topic.id,
      name: topic.name,
      materialCount: materialsByTopic.get(topic.id) ?? 0,
      questionCount: questionsByTopic.get(topic.id) ?? 0,
      lowContent: topic.lowContent,
      jobState: jobByTopic.get(topic.id) ?? null,
    })),
  }
}

export interface LibrarySearchResult {
  topicId: string
  topicName: string
  subjectName: string
  gradeName: string
  /** Vyplněno, když shoda padla na název materiálu, ne na název tématu. */
  matchedFileName: string | null
}

/** Odstraní diakritiku a sjednotí velikost písmen, aby „potravni“ našlo „potravní“. */
function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('cs')
}

/**
 * Hledání přes celou knihovnu, ne jen ve zvoleném ročníku — při 124 tématech
 * je proklikávání ročníků pomalejší než napsat pár písmen. Hledá jak v názvu
 * tématu, tak v názvech materiálů: u témat typu „PL - potravní řetězce“ bývá
 * název souboru výmluvnější než název tématu.
 */
export async function searchLibrary(scope: Scope, query: string): Promise<LibrarySearchResult[]> {
  const needle = foldForSearch(query.trim())
  if (needle.length < 2) return []

  const [topicRows, materialRows] = await Promise.all([
    db
      .select({
        topicId: topics.id,
        topicName: topics.name,
        gradeName: grades.name,
        subjectName: subjects.name,
      })
      .from(topics)
      .innerJoin(grades, eq(grades.id, topics.gradeId))
      .innerJoin(subjects, eq(subjects.id, grades.subjectId))
      .where(skola(scope, topics))
      .orderBy(asc(subjects.position), asc(grades.position), asc(topics.position)),
    db
      .select({ topicId: materials.topicId, fileName: materials.fileName })
      .from(materials)
      .where(skola(scope, materials)),
  ])

  const fileNamesByTopic = new Map<string, string[]>()
  for (const material of materialRows) {
    const list = fileNamesByTopic.get(material.topicId) ?? []
    list.push(material.fileName)
    fileNamesByTopic.set(material.topicId, list)
  }

  const results: LibrarySearchResult[] = []
  for (const topic of topicRows) {
    if (foldForSearch(topic.topicName).includes(needle)) {
      results.push({ ...topic, matchedFileName: null })
      continue
    }
    const fileMatch = (fileNamesByTopic.get(topic.topicId) ?? []).find((fileName) =>
      foldForSearch(fileName).includes(needle),
    )
    if (fileMatch) results.push({ ...topic, matchedFileName: fileMatch })
  }

  return results.slice(0, 30)
}

/**
 * Najde nebo založí předmět daného názvu.
 *
 * Patra knihovny (předmět → ročník → téma) mají každé svou funkci, aby šlo
 * založit i samotný předmět bez ročníku a tématu. `ensureTopic` je jen skládá
 * dohromady — jiná cesta k založení položky v knihovně neexistuje.
 */
export async function ensureSubject(scope: Scope, name: string): Promise<string> {
  const subjectName = name.trim()
  return upsertReturningId(
    () =>
      db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(skola(scope, subjects), eq(subjects.name, subjectName)))
        .limit(1),
    (id) =>
      db
        .insert(subjects)
        .values({ id, schoolId: scope.schoolId, createdBy: scope.userId, name: subjectName })
        .onConflictDoNothing(),
  )
}

/** Najde nebo založí ročník daného názvu v předmětu. Prázdný název znamená „bez ročníku“. */
export async function ensureGradeIn(scope: Scope, subjectId: string, name: string): Promise<string> {
  const gradeName = name.trim()
  return upsertReturningId(
    () =>
      db
        .select({ id: grades.id })
        .from(grades)
        .where(and(skola(scope, grades), eq(grades.subjectId, subjectId), eq(grades.name, gradeName)))
        .limit(1),
    (id) =>
      db
        .insert(grades)
        .values({
          id,
          schoolId: scope.schoolId,
          createdBy: scope.userId,
          subjectId,
          name: gradeName,
          position: gradePosition(gradeName),
        })
        .onConflictDoNothing(),
  )
}

/**
 * Najde nebo založí téma daného názvu v ročníku.
 *
 * Když `group` platí, materiál se připojí k existujícímu tématu se stejným
 * obsahovým názvem („Měkkýši“ a „6.22 Měkkýši (Mollusca)“). Při ručním
 * zakládání se slučování vypíná: co učitelka napíše, má vzniknout přesně tak.
 */
export async function ensureTopicIn(
  scope: Scope,
  gradeId: string,
  name: string,
  options: { group?: boolean } = {},
): Promise<string> {
  const topicName = name.trim()

  const [exact] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(skola(scope, topics), eq(topics.gradeId, gradeId), eq(topics.name, topicName)))
    .limit(1)
  if (exact) return exact.id

  if (options.group !== false) {
    const siblings = await db
      .select({ id: topics.id, name: topics.name })
      .from(topics)
      .where(and(skola(scope, topics), eq(topics.gradeId, gradeId)))
    const match = findMatchingTopic(siblings, topicName)
    if (match) {
      // Stručnější z obou názvů popisuje skupinu lépe.
      const preferred = preferredTopicName(match.name, topicName)
      if (preferred !== match.name) {
        await db.update(topics).set({ name: preferred }).where(eq(topics.id, match.id))
      }
      return match.id
    }
  }

  const id = newId()
  // Čerstvé téma nemá žádný materiál, takže použitelného textu má nula —
  // `lowContent` to musí říct rovnou, ne až po prvním přepočtu.
  await db
    .insert(topics)
    .values({
      id,
      schoolId: scope.schoolId,
      createdBy: scope.userId,
      gradeId,
      name: topicName,
      usableCharCount: 0,
      lowContent: true,
    })
    .onConflictDoNothing()
  const [created] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(skola(scope, topics), eq(topics.gradeId, gradeId), eq(topics.name, topicName)))
    .limit(1)
  return created?.id ?? id
}

/**
 * Najde nebo založí téma podle názvů předmětu, ročníku a tématu.
 *
 * Když `group` platí, soubor se připojí k existujícímu tématu se stejným
 * obsahovým názvem. Jedno téma je skupina materiálů, ze které se pak generuje
 * dohromady.
 */
export async function ensureTopic(
  scope: Scope,
  input: {
    subject: string
    grade: string | null
    topic: string
    group?: boolean
  },
): Promise<string> {
  const subjectId = await ensureSubject(scope, input.subject)
  const gradeId = await ensureGradeIn(scope, subjectId, input.grade ?? '')
  return ensureTopicIn(scope, gradeId, input.topic, { group: input.group })
}

/** Ročník řadíme číselně, prázdný ("bez ročníku") jde první. */
function gradePosition(name: string): number {
  const match = /^(\d+)/.exec(name)
  return match ? Number(match[1]) : 0
}

async function upsertReturningId(
  find: () => Promise<{ id: string }[]>,
  insert: (id: string) => Promise<unknown>,
): Promise<string> {
  const existing = await find()
  if (existing[0]) return existing[0].id
  const id = newId()
  await insert(id)
  const after = await find()
  return after[0]?.id ?? id
}

/** Patro knihovny, se kterým se pracuje. */
export type LibraryKind = 'subject' | 'grade' | 'topic'

/** Hotovo: id založené nebo přejmenované položky. */
export interface LibraryDone {
  ok: true
  id: string
}

/** Odmítnutí i s hláškou pro učitelku; `status` jde rovnou do odpovědi API. */
export interface LibraryRefusal {
  ok: false
  status: number
  error: string
}

export type LibraryResult = LibraryDone | LibraryRefusal

const KIND_LABEL: Record<LibraryKind, string> = {
  subject: 'Předmět',
  grade: 'Ročník',
  topic: 'Téma',
}

/**
 * Založí předmět, ročník nebo téma ručně, bez importu materiálů.
 *
 * Ročník bez předmětu ani téma bez ročníku neexistují — chybějící nadřazená
 * položka je odmítnutí s vysvětlením, ne pád.
 */
export async function createLibraryItem(
  scope: Scope,
  input: {
    kind: LibraryKind
    name: string
    parentId?: string | null
  },
): Promise<LibraryResult> {
  const name = input.name.trim()
  if (!name) return { ok: false, status: 400, error: `${KIND_LABEL[input.kind]} se bez názvu založit nedá.` }

  if (input.kind === 'subject') {
    if (await findSubjectByName(scope, name)) {
      return { ok: false, status: 409, error: `Předmět „${name}“ v knihovně už je.` }
    }
    return { ok: true, id: await ensureSubject(scope, name) }
  }

  if (input.kind === 'grade') {
    if (!input.parentId) {
      return {
        ok: false,
        status: 400,
        error: 'Ročník patří vždy do nějakého předmětu. Vyber nejdřív předmět, pod který ho chceš založit.',
      }
    }
    const [subject] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(skola(scope, subjects), eq(subjects.id, input.parentId)))
      .limit(1)
    if (!subject) {
      return { ok: false, status: 404, error: 'Předmět, do kterého měl ročník patřit, v knihovně není.' }
    }
    if (await findGradeByName(scope, subject.id, name)) {
      return { ok: false, status: 409, error: `Ročník „${name}“ v tomto předmětu už je.` }
    }
    return { ok: true, id: await ensureGradeIn(scope, subject.id, name) }
  }

  if (!input.parentId) {
    return {
      ok: false,
      status: 400,
      error: 'Téma patří vždy do nějakého ročníku. Vyber nejdřív ročník, ve kterém má téma vzniknout.',
    }
  }
  const [grade] = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(skola(scope, grades), eq(grades.id, input.parentId)))
    .limit(1)
  if (!grade) {
    return { ok: false, status: 404, error: 'Ročník, do kterého mělo téma patřit, v knihovně není.' }
  }
  if (await findTopicByName(scope, grade.id, name)) {
    return { ok: false, status: 409, error: `Téma „${name}“ v tomto ročníku už je.` }
  }
  return { ok: true, id: await ensureTopicIn(scope, grade.id, name, { group: false }) }
}

/**
 * Přejmenuje předmět, ročník nebo téma.
 *
 * Dva předměty téhož jména ani dva ročníky stejného jména v jednom předmětu
 * nejsou možné (brání tomu unikátní index) — místo chyby z databáze se vrací
 * odmítnutí s návodem, co s tím.
 */
export async function renameLibraryItem(
  scope: Scope,
  input: {
    kind: LibraryKind
    id: string
    name: string
  },
): Promise<LibraryResult> {
  const name = input.name.trim()
  if (!name) return { ok: false, status: 400, error: 'Název nesmí zůstat prázdný.' }

  if (input.kind === 'subject') {
    const [subject] = await db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(and(skola(scope, subjects), eq(subjects.id, input.id)))
      .limit(1)
    if (!subject) return { ok: false, status: 404, error: 'Předmět v knihovně není.' }
    if (subject.name === name) return { ok: true, id: subject.id }

    const duplicate = await findSubjectByName(scope, name)
    if (duplicate && duplicate.id !== subject.id) {
      return {
        ok: false,
        status: 409,
        error: `Předmět „${name}“ v knihovně už je. Dva předměty téhož jména by nešlo rozlišit — zvol jiný název, nebo ročníky z tohoto předmětu přeřaď po tématech do toho druhého a tenhle smaž.`,
      }
    }
    await db.update(subjects).set({ name }).where(eq(subjects.id, subject.id))
    return { ok: true, id: subject.id }
  }

  if (input.kind === 'grade') {
    const [grade] = await db
      .select({ id: grades.id, name: grades.name, subjectId: grades.subjectId })
      .from(grades)
      .where(and(skola(scope, grades), eq(grades.id, input.id)))
      .limit(1)
    if (!grade) return { ok: false, status: 404, error: 'Ročník v knihovně není.' }
    if (grade.name === name) return { ok: true, id: grade.id }

    const duplicate = await findGradeByName(scope, grade.subjectId, name)
    if (duplicate && duplicate.id !== grade.id) {
      return {
        ok: false,
        status: 409,
        error: `Ročník „${name}“ v tomto předmětu už je. Zvol jiný název, nebo témata odtud přesuň do něj — v podrobnostech tématu přes „Upravit téma“ a volbu ročníku.`,
      }
    }
    // Řazení ročníků se počítá z názvu, takže se musí přepočítat spolu s ním —
    // jinak by přejmenovaný „9. ročník“ zůstal viset tam, kde byl „2. ročník“.
    await db
      .update(grades)
      .set({ name, position: gradePosition(name) })
      .where(eq(grades.id, grade.id))
    return { ok: true, id: grade.id }
  }

  const [topic] = await db
    .select({ id: topics.id, name: topics.name, gradeId: topics.gradeId })
    .from(topics)
    .where(and(skola(scope, topics), eq(topics.id, input.id)))
    .limit(1)
  if (!topic) return { ok: false, status: 404, error: 'Téma v knihovně není.' }
  if (topic.name === name) return { ok: true, id: topic.id }

  const duplicate = await findTopicByName(scope, topic.gradeId, name)
  if (duplicate && duplicate.id !== topic.id) {
    return {
      ok: false,
      status: 409,
      error: `Téma „${name}“ v tomto ročníku už je. Zvol jiný název, nebo obě témata spoj — v podrobnostech tématu přes „Upravit téma“ a „Sloučit do jiného tématu“.`,
    }
  }
  await db.update(topics).set({ name }).where(eq(topics.id, topic.id))
  return { ok: true, id: topic.id }
}

async function findSubjectByName(scope: Scope, name: string): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(skola(scope, subjects), eq(subjects.name, name)))
    .limit(1)
  return row
}

async function findGradeByName(
  scope: Scope,
  subjectId: string,
  name: string,
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(skola(scope, grades), eq(grades.subjectId, subjectId), eq(grades.name, name)))
    .limit(1)
  return row
}

async function findTopicByName(
  scope: Scope,
  gradeId: string,
  name: string,
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(skola(scope, topics), eq(topics.gradeId, gradeId), eq(topics.name, name)))
    .limit(1)
  return row
}

/** Názvy témat pro zobrazení u otázek. */
export async function topicLabels(scope: Scope, topicIds: string[]): Promise<Map<string, string>> {
  if (topicIds.length === 0) return new Map()
  const rows = await db
    .select({
      id: topics.id,
      topic: topics.name,
      grade: grades.name,
      subject: subjects.name,
    })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(skola(scope, topics), inArray(topics.id, topicIds)))

  return new Map(
    rows.map((row) => [row.id, [row.subject, row.grade, row.topic].filter(Boolean).join(' · ')]),
  )
}
