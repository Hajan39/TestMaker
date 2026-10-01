import 'server-only'
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import { findMatchingTopic, preferredTopicName } from '@testmaker/core/extract'
import { db, generationJobs, grades, materials, questions, subjects, topics } from '@/db'
import { inSchool, type Scope } from './user'
import { newId } from './ids'
import { t } from '@testmaker/core/i18n'

/**
 * The library is shared by the whole school, but never across schools. The
 * scope is therefore the first parameter of every function in this module:
 * forgetting to pass it fails to compile.
 */

export interface TopicNode {
  id: string
  name: string
  materialCount: number
  /** The topic's questions except deleted ones — a deleted card does not count. */
  questionCount: number
  /** Too little usable text (without duplicates) for a test — see `MIN_USABLE_TOPIC_CHARS`. */
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

/** The whole Subject → Grade → Topic tree with material and question counts. */
export async function loadLibraryTree(scope: Scope): Promise<SubjectNode[]> {
  const [subjectRows, gradeRows, topicRows, materialCounts, questionCounts] = await Promise.all([
    db
      .select()
      .from(subjects)
      .where(inSchool(scope, subjects))
      .orderBy(asc(subjects.position), asc(subjects.name)),
    db
      .select()
      .from(grades)
      .where(inSchool(scope, grades))
      .orderBy(asc(grades.position), asc(grades.name)),
    db
      .select()
      .from(topics)
      .where(inSchool(scope, topics))
      .orderBy(asc(topics.position), asc(topics.name)),
    db
      .select({ topicId: materials.topicId, value: count() })
      .from(materials)
      .where(inSchool(scope, materials))
      .groupBy(materials.topicId),
    db
      .select({
        topicId: questions.topicId,
        // Deleted (rejected) ones don't count — their card disappears anyway,
        // so the number on top would lie.
        total: sql<number>`sum(case when ${questions.status} != 'rejected' then 1 else 0 end)`,
      })
      .from(questions)
      .where(inSchool(scope, questions))
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

/** Generation state of a topic in the queue — only what the class page needs to show. */
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
 * Data for the class page: the class name (subject + grade) and its topics with
 * counts and generation state. A foreign or missing grade returns `null` —
 * the page answers with `notFound()`, not an error.
 */
export async function loadClassTopics(scope: Scope, gradeId: string): Promise<ClassInfo | null> {
  const [grade] = await db
    .select({ id: grades.id, name: grades.name, subjectId: grades.subjectId, subjectName: subjects.name })
    .from(grades)
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(inSchool(scope, grades), eq(grades.id, gradeId)))
    .limit(1)
  if (!grade) return null

  const topicRows = await db
    .select({ id: topics.id, name: topics.name, lowContent: topics.lowContent })
    .from(topics)
    .where(and(inSchool(scope, topics), eq(topics.gradeId, gradeId)))
    .orderBy(asc(topics.position), asc(topics.name))
  const topicIds = topicRows.map((topic) => topic.id)

  const [materialCounts, questionCounts, jobRows] = await Promise.all([
    topicIds.length
      ? db
          .select({ topicId: materials.topicId, value: count() })
          .from(materials)
          .where(and(inSchool(scope, materials), inArray(materials.topicId, topicIds)))
          .groupBy(materials.topicId)
      : Promise.resolve([]),
    topicIds.length
      ? db
          .select({
            topicId: questions.topicId,
            total: sql<number>`sum(case when ${questions.status} != 'rejected' then 1 else 0 end)`,
          })
          .from(questions)
          .where(and(inSchool(scope, questions), inArray(questions.topicId, topicIds)))
          .groupBy(questions.topicId)
      : Promise.resolve([]),
    topicIds.length
      ? db
          .select({ topicId: generationJobs.topicId, status: generationJobs.status })
          .from(generationJobs)
          .where(
            and(
              inSchool(scope, generationJobs),
              inArray(generationJobs.topicId, topicIds),
              inArray(generationJobs.status, ['queued', 'running']),
            ),
          )
      : Promise.resolve([]),
  ])

  const materialsByTopic = new Map(materialCounts.map((row) => [row.topicId, row.value]))
  const questionsByTopic = new Map(questionCounts.map((row) => [row.topicId, Number(row.total)]))

  // A running job wins over a queued one should both point at the same
  // topic — but the queued one still counts while nothing is running.
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
  /** Set when the match hit a material's file name, not the topic name. */
  matchedFileName: string | null
}

/** Strips diacritics and folds case so that "potravni" finds "potravní". */
function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('cs')
}

/**
 * Search across the whole library, not just the selected grade — with 124
 * topics clicking through grades is slower than typing a few letters. Matches
 * both topic names and material file names: for topics like
 * "PL - potravní řetězce" the file name is often more telling than the topic name.
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
      .where(inSchool(scope, topics))
      .orderBy(asc(subjects.position), asc(grades.position), asc(topics.position)),
    db
      .select({ topicId: materials.topicId, fileName: materials.fileName })
      .from(materials)
      .where(inSchool(scope, materials)),
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
 * Finds or creates a subject with the given name.
 *
 * Each library level (subject → grade → topic) has its own function so a
 * subject can be created alone, without a grade or topic. `ensureTopic` just
 * chains them — there is no other way to create a library item.
 */
export async function ensureSubject(scope: Scope, name: string): Promise<string> {
  const subjectName = name.trim()
  return upsertReturningId(
    () =>
      db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(inSchool(scope, subjects), eq(subjects.name, subjectName)))
        .limit(1),
    (id) =>
      db
        .insert(subjects)
        .values({ id, schoolId: scope.schoolId, createdBy: scope.userId, name: subjectName })
        .onConflictDoNothing(),
  )
}

/** Finds or creates a grade with the given name in a subject. An empty name means "no grade". */
export async function ensureGradeIn(scope: Scope, subjectId: string, name: string): Promise<string> {
  const gradeName = name.trim()
  return upsertReturningId(
    () =>
      db
        .select({ id: grades.id })
        .from(grades)
        .where(and(inSchool(scope, grades), eq(grades.subjectId, subjectId), eq(grades.name, gradeName)))
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
 * Finds or creates a topic with the given name in a grade.
 *
 * When `group` is set, the material joins an existing topic with the same
 * content name ("Měkkýši" and "6.22 Měkkýši (Mollusca)"). Manual creation
 * turns grouping off: what the teacher types is created exactly as typed.
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
    .where(and(inSchool(scope, topics), eq(topics.gradeId, gradeId), eq(topics.name, topicName)))
    .limit(1)
  if (exact) return exact.id

  if (options.group !== false) {
    const siblings = await db
      .select({ id: topics.id, name: topics.name })
      .from(topics)
      .where(and(inSchool(scope, topics), eq(topics.gradeId, gradeId)))
    const match = findMatchingTopic(siblings, topicName)
    if (match) {
      // The shorter of the two names describes the group better.
      const preferred = preferredTopicName(match.name, topicName)
      if (preferred !== match.name) {
        await db.update(topics).set({ name: preferred }).where(eq(topics.id, match.id))
      }
      return match.id
    }
  }

  const id = newId()
  // A fresh topic has no material, so it has zero usable text —
  // `lowContent` must say so right away, not only after the first recount.
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
    .where(and(inSchool(scope, topics), eq(topics.gradeId, gradeId), eq(topics.name, topicName)))
    .limit(1)
  return created?.id ?? id
}

/**
 * Finds or creates a topic by subject, grade and topic names.
 *
 * When `group` is set, the file joins an existing topic with the same content
 * name. A topic is a group of materials that is generated from together.
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

/** Grades sort numerically; the empty one ("no grade") goes first. */
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

/** The library level being worked with. */
export type LibraryKind = 'subject' | 'grade' | 'topic'

/** Done: id of the created or renamed item. */
export interface LibraryDone {
  ok: true
  id: string
}

/** A refusal with a message for the teacher; `status` goes straight into the API response. */
export interface LibraryRefusal {
  ok: false
  status: number
  error: string
}

export type LibraryResult = LibraryDone | LibraryRefusal

/**
 * Creates a subject, grade or topic manually, without importing materials.
 *
 * A grade without a subject or a topic without a grade doesn't exist — a
 * missing parent is a refusal with an explanation, not a crash.
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
  if (!name) return { ok: false, status: 400, error: t(`library:libraryItems.nameRequired.${input.kind}`) }

  if (input.kind === 'subject') {
    if (await findSubjectByName(scope, name)) {
      return { ok: false, status: 409, error: t('library:libraryItems.subjectExists', { name }) }
    }
    return { ok: true, id: await ensureSubject(scope, name) }
  }

  if (input.kind === 'grade') {
    if (!input.parentId) {
      return {
        ok: false,
        status: 400,
        error: t('library:libraryItems.gradeNeedsSubject'),
      }
    }
    const [subject] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(and(inSchool(scope, subjects), eq(subjects.id, input.parentId)))
      .limit(1)
    if (!subject) {
      return { ok: false, status: 404, error: t('library:libraryItems.parentSubjectMissing') }
    }
    if (await findGradeByName(scope, subject.id, name)) {
      return { ok: false, status: 409, error: t('library:libraryItems.gradeExists', { name }) }
    }
    return { ok: true, id: await ensureGradeIn(scope, subject.id, name) }
  }

  if (!input.parentId) {
    return {
      ok: false,
      status: 400,
      error: t('library:libraryItems.topicNeedsGrade'),
    }
  }
  const [grade] = await db
    .select({ id: grades.id })
    .from(grades)
    .where(and(inSchool(scope, grades), eq(grades.id, input.parentId)))
    .limit(1)
  if (!grade) {
    return { ok: false, status: 404, error: t('library:libraryItems.parentGradeMissing') }
  }
  if (await findTopicByName(scope, grade.id, name)) {
    return { ok: false, status: 409, error: t('library:libraryItems.topicExists', { name }) }
  }
  return { ok: true, id: await ensureTopicIn(scope, grade.id, name, { group: false }) }
}

/**
 * Renames a subject, grade or topic.
 *
 * Two subjects with the same name, or two grades with the same name in one
 * subject, are impossible (a unique index prevents it) — instead of a database
 * error a refusal with guidance is returned.
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
  if (!name) return { ok: false, status: 400, error: t('library:libraryItems.nameEmpty') }

  if (input.kind === 'subject') {
    const [subject] = await db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(and(inSchool(scope, subjects), eq(subjects.id, input.id)))
      .limit(1)
    if (!subject) return { ok: false, status: 404, error: t('library:libraryItems.subjectMissing') }
    if (subject.name === name) return { ok: true, id: subject.id }

    const duplicate = await findSubjectByName(scope, name)
    if (duplicate && duplicate.id !== subject.id) {
      return {
        ok: false,
        status: 409,
        error: t('library:libraryItems.renameSubjectExists', { name }),
      }
    }
    await db.update(subjects).set({ name }).where(eq(subjects.id, subject.id))
    return { ok: true, id: subject.id }
  }

  if (input.kind === 'grade') {
    const [grade] = await db
      .select({ id: grades.id, name: grades.name, subjectId: grades.subjectId })
      .from(grades)
      .where(and(inSchool(scope, grades), eq(grades.id, input.id)))
      .limit(1)
    if (!grade) return { ok: false, status: 404, error: t('library:libraryItems.gradeMissing') }
    if (grade.name === name) return { ok: true, id: grade.id }

    const duplicate = await findGradeByName(scope, grade.subjectId, name)
    if (duplicate && duplicate.id !== grade.id) {
      return {
        ok: false,
        status: 409,
        error: t('library:libraryItems.renameGradeExists', { name }),
      }
    }
    // Grade order is derived from the name, so it must be recomputed with it —
    // otherwise a renamed "9. ročník" would stay where "2. ročník" used to be.
    await db
      .update(grades)
      .set({ name, position: gradePosition(name) })
      .where(eq(grades.id, grade.id))
    return { ok: true, id: grade.id }
  }

  const [topic] = await db
    .select({ id: topics.id, name: topics.name, gradeId: topics.gradeId })
    .from(topics)
    .where(and(inSchool(scope, topics), eq(topics.id, input.id)))
    .limit(1)
  if (!topic) return { ok: false, status: 404, error: t('library:libraryItems.topicMissing') }
  if (topic.name === name) return { ok: true, id: topic.id }

  const duplicate = await findTopicByName(scope, topic.gradeId, name)
  if (duplicate && duplicate.id !== topic.id) {
    return {
      ok: false,
      status: 409,
      error: t('library:libraryItems.renameTopicExists', { name }),
    }
  }
  await db.update(topics).set({ name }).where(eq(topics.id, topic.id))
  return { ok: true, id: topic.id }
}

async function findSubjectByName(scope: Scope, name: string): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(inSchool(scope, subjects), eq(subjects.name, name)))
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
    .where(and(inSchool(scope, grades), eq(grades.subjectId, subjectId), eq(grades.name, name)))
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
    .where(and(inSchool(scope, topics), eq(topics.gradeId, gradeId), eq(topics.name, name)))
    .limit(1)
  return row
}

/** Topic labels shown next to questions. */
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
    .where(and(inSchool(scope, topics), inArray(topics.id, topicIds)))

  return new Map(
    rows.map((row) => [row.id, [row.subject, row.grade, row.topic].filter(Boolean).join(' · ')]),
  )
}
