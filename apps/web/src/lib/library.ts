import 'server-only'
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { findMatchingTopic, preferredTopicName } from '@testmaker/core/extract'
import { db, grades, materials, questions, subjects, topics } from '@/db'
import { newId } from './ids'

export interface TopicNode {
  id: string
  name: string
  materialCount: number
  questionCount: number
  approvedCount: number
  draftCount: number
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
export async function loadLibraryTree(): Promise<SubjectNode[]> {
  const [subjectRows, gradeRows, topicRows, materialCounts, questionCounts] = await Promise.all([
    db.select().from(subjects).orderBy(asc(subjects.position), asc(subjects.name)),
    db.select().from(grades).orderBy(asc(grades.position), asc(grades.name)),
    db.select().from(topics).orderBy(asc(topics.position), asc(topics.name)),
    db
      .select({ topicId: materials.topicId, value: count() })
      .from(materials)
      .groupBy(materials.topicId),
    db
      .select({
        topicId: questions.topicId,
        total: count(),
        approved: sql<number>`sum(case when ${questions.status} = 'approved' then 1 else 0 end)`,
        draft: sql<number>`sum(case when ${questions.status} = 'draft' then 1 else 0 end)`,
      })
      .from(questions)
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
      questionCount: stats?.total ?? 0,
      approvedCount: Number(stats?.approved ?? 0),
      draftCount: Number(stats?.draft ?? 0),
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
export async function searchLibrary(query: string): Promise<LibrarySearchResult[]> {
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
      .orderBy(asc(subjects.position), asc(grades.position), asc(topics.position)),
    db.select({ topicId: materials.topicId, fileName: materials.fileName }).from(materials),
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
 * Najde nebo založí téma podle názvů předmětu, ročníku a tématu.
 *
 * Když `group` platí, soubor se připojí k existujícímu tématu se stejným
 * obsahovým názvem („Měkkýši“ a „6.22 Měkkýši (Mollusca)“). Jedno téma je
 * skupina materiálů, ze které se pak generuje dohromady.
 */
export async function ensureTopic(input: {
  subject: string
  grade: string | null
  topic: string
  group?: boolean
}): Promise<string> {
  const subjectName = input.subject.trim()
  const gradeName = (input.grade ?? '').trim()
  const topicName = input.topic.trim()

  const subjectId = await upsertReturningId(
    () => db.select({ id: subjects.id }).from(subjects).where(eq(subjects.name, subjectName)).limit(1),
    (id) => db.insert(subjects).values({ id, name: subjectName }).onConflictDoNothing(),
  )

  const gradeId = await upsertReturningId(
    () =>
      db
        .select({ id: grades.id })
        .from(grades)
        .where(and(eq(grades.subjectId, subjectId), eq(grades.name, gradeName)))
        .limit(1),
    (id) =>
      db
        .insert(grades)
        .values({ id, subjectId, name: gradeName, position: gradePosition(gradeName) })
        .onConflictDoNothing(),
  )

  const [exact] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.gradeId, gradeId), eq(topics.name, topicName)))
    .limit(1)
  if (exact) return exact.id

  if (input.group !== false) {
    const siblings = await db
      .select({ id: topics.id, name: topics.name })
      .from(topics)
      .where(eq(topics.gradeId, gradeId))
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
  await db.insert(topics).values({ id, gradeId, name: topicName }).onConflictDoNothing()
  const [created] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.gradeId, gradeId), eq(topics.name, topicName)))
    .limit(1)
  return created?.id ?? id
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

/** Názvy témat pro zobrazení u otázek. */
export async function topicLabels(topicIds: string[]): Promise<Map<string, string>> {
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
    .where(inArray(topics.id, topicIds))

  return new Map(
    rows.map((row) => [row.id, [row.subject, row.grade, row.topic].filter(Boolean).join(' · ')]),
  )
}
