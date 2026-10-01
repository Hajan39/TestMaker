import { BUILT_IN_TEMPLATES, type QuestionType } from '@testmaker/core/schema'
import { db, grades, materials, questions, subjects, templates, topics, users } from '@/db'
import { newId } from '@/lib/ids'
import { searchTextFor } from '@/lib/questions'
import type { Role } from '@/lib/role'
import type { SignedInUser } from '@/lib/user'
import { TEST_SCHOOL_ID, TEST_ACCOUNT_ID } from './setup'

/**
 * The account tests call library functions with. Matches what the app itself
 * uses when sign-in is off.
 */
export const ACCOUNT: SignedInUser = {
  schoolId: TEST_SCHOOL_ID,
  userId: TEST_ACCOUNT_ID,
  role: 'spravce',
  name: 'Testovací správce',
  email: 'test@localhost',
  schoolName: 'Testovací škola',
  homeSchoolId: TEST_SCHOOL_ID,
  sid: 'bez-prihlaseni',
  mustChangePassword: false,
}

/** A second teacher's account — for tests that others' content is not visible. */
export async function seedAccount(options: { role?: Role } = {}): Promise<SignedInUser> {
  const id = newId()
  await db.insert(users).values({
    id,
    schoolId: TEST_SCHOOL_ID,
    email: `${id}@localhost`,
    name: `Učitelka ${id}`,
    role: options.role ?? 'ucitelka',
  })
  return {
    schoolId: TEST_SCHOOL_ID,
    userId: id,
    role: options.role ?? 'ucitelka',
    name: `Učitelka ${id}`,
    email: `${id}@localhost`,
    schoolName: 'Testovací škola',
    homeSchoolId: TEST_SCHOOL_ID,
    sid: 'bez-prihlaseni',
    mustChangePassword: false,
  }
}

/** A request for a route handler — they take a plain `Request`. */
export function req(url: string, init?: RequestInit): Request {
  return new Request(new URL(url, 'http://localhost').toString(), init)
}

/** A request with a JSON body. */
export function jsonReq(url: string, method: string, body: unknown): Request {
  return req(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** A built-in template in the database — without it a test has nothing to point to. */
export async function seedTemplate(slug = 'klasicka'): Promise<string> {
  const builtIn = BUILT_IN_TEMPLATES.find((template) => template.slug === slug) ?? BUILT_IN_TEMPLATES[0]!
  const id = `builtin-${builtIn.slug}`
  await db
    .insert(templates)
    .values({
      id,
      schoolId: TEST_SCHOOL_ID,
      slug: builtIn.slug,
      name: builtIn.name,
      description: builtIn.description,
      config: builtIn.config,
      builtIn: true,
      position: 0,
    })
    .onConflictDoNothing()
  return id
}

export interface SeededTopic {
  subjectId: string
  gradeId: string
  topicId: string
}

/** Subject → grade → topic. Returns the ids of all three levels. */
export async function seedTopic(options: {
  subject?: string
  grade?: string
  topic?: string
} = {}): Promise<SeededTopic> {
  const subjectId = newId()
  const gradeId = newId()
  const topicId = newId()

  await db
    .insert(subjects)
    .values({ id: subjectId, schoolId: TEST_SCHOOL_ID, name: options.subject ?? `Předmět ${subjectId}` })
  await db
    .insert(grades)
    .values({ id: gradeId, schoolId: TEST_SCHOOL_ID, subjectId, name: options.grade ?? '8. ročník' })
  await db
    .insert(topics)
    .values({ id: topicId, schoolId: TEST_SCHOOL_ID, gradeId, name: options.topic ?? `Téma ${topicId}` })

  return { subjectId, gradeId, topicId }
}

/** A material with finished text — as the browser sends it after extraction. */
export async function seedMaterial(
  topicId: string,
  options: { fileName?: string; text?: string; excluded?: boolean; needsOcr?: boolean } = {},
): Promise<string> {
  const id = newId()
  const fileName = options.fileName ?? `${id}.txt`
  const text = options.text ?? 'Nějaký text materiálu. '.repeat(10)
  await db.insert(materials).values({
    id,
    schoolId: TEST_SCHOOL_ID,
    topicId,
    fileName,
    relativePath: `Předmět/8. ročník/${fileName}`,
    mimeType: 'text/plain',
    sizeBytes: text.length,
    text,
    charCount: text.length,
    pageCount: null,
    needsOcr: options.needsOcr ?? false,
    excluded: options.excluded ?? false,
    contentHash: `hash-${id}`,
  })
  return id
}

/** A question in the bank. The default is a simple single choice. */
export async function seedQuestion(
  topicId: string | null,
  options: {
    prompt?: string
    status?: 'draft' | 'approved' | 'rejected'
    /** Question type — for the type filter; the payload stays simple. */
    type?: QuestionType
    /** Manual timestamps — "newest first" sorting tests need a certain order. */
    createdAt?: string
    reviewedAt?: string | null
    source?: 'ai' | 'manual'
  } = {},
): Promise<string> {
  const id = newId()
  const payload = {
    prompt: options.prompt ?? 'Kde probíhá výměna plynů?',
    options: ['V průdušnici', 'V plicních sklípcích'],
    correctIndex: 1,
  }
  await db.insert(questions).values({
    id,
    schoolId: TEST_SCHOOL_ID,
    createdBy: TEST_ACCOUNT_ID,
    topicId,
    materialId: null,
    type: options.type ?? 'single_choice',
    payload,
    blocks: [],
    points: 1,
    difficulty: 2,
    source: options.source ?? 'ai',
    status: options.status ?? 'approved',
    // As in the app: the search text is filled when the question is written.
    searchText: searchTextFor({ payload }),
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    ...(options.reviewedAt !== undefined ? { reviewedAt: options.reviewedAt } : {}),
  })
  return id
}
