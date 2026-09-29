import { BUILT_IN_TEMPLATES, type QuestionType } from '@testmaker/core/schema'
import { db, grades, materials, questions, subjects, templates, topics, users } from '@/db'
import { newId } from '@/lib/ids'
import { searchTextFor } from '@/lib/questions'
import type { Role } from '@/lib/role'
import type { Prihlaseny } from '@/lib/uzivatel'
import { TEST_SKOLA_ID, TEST_UCET_ID } from './setup'

/**
 * Účet, pod kterým testy volají funkce knihovny. Odpovídá tomu, co aplikace
 * sama použije, když je přihlašování vypnuté.
 */
export const UCET: Prihlaseny = {
  schoolId: TEST_SKOLA_ID,
  userId: TEST_UCET_ID,
  role: 'spravce',
  jmeno: 'Testovací správce',
  email: 'test@localhost',
  skola: 'Testovací škola',
  domovskaSkolaId: TEST_SKOLA_ID,
  sid: 'bez-prihlaseni',
  mustChangePassword: false,
}

/** Účet druhé učitelky — pro testy, že cizí obsah není vidět. */
export async function seedUcet(options: { role?: Role } = {}): Promise<Prihlaseny> {
  const id = newId()
  await db.insert(users).values({
    id,
    schoolId: TEST_SKOLA_ID,
    email: `${id}@localhost`,
    name: `Učitelka ${id}`,
    role: options.role ?? 'ucitelka',
  })
  return {
    schoolId: TEST_SKOLA_ID,
    userId: id,
    role: options.role ?? 'ucitelka',
    jmeno: `Učitelka ${id}`,
    email: `${id}@localhost`,
    skola: 'Testovací škola',
    domovskaSkolaId: TEST_SKOLA_ID,
    sid: 'bez-prihlaseni',
    mustChangePassword: false,
  }
}

/** Požadavek na route handler — ty berou obyčejný `Request`. */
export function req(url: string, init?: RequestInit): Request {
  return new Request(new URL(url, 'http://localhost').toString(), init)
}

/** Požadavek s tělem v JSON. */
export function jsonReq(url: string, method: string, body: unknown): Request {
  return req(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Vestavěná šablona v databázi — bez ní nemá test kam ukázat. */
export async function seedTemplate(slug = 'klasicka'): Promise<string> {
  const builtIn = BUILT_IN_TEMPLATES.find((template) => template.slug === slug) ?? BUILT_IN_TEMPLATES[0]!
  const id = `builtin-${builtIn.slug}`
  await db
    .insert(templates)
    .values({
      id,
      schoolId: TEST_SKOLA_ID,
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

/** Předmět → ročník → téma. Vrací id všech tří pater. */
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
    .values({ id: subjectId, schoolId: TEST_SKOLA_ID, name: options.subject ?? `Předmět ${subjectId}` })
  await db
    .insert(grades)
    .values({ id: gradeId, schoolId: TEST_SKOLA_ID, subjectId, name: options.grade ?? '8. ročník' })
  await db
    .insert(topics)
    .values({ id: topicId, schoolId: TEST_SKOLA_ID, gradeId, name: options.topic ?? `Téma ${topicId}` })

  return { subjectId, gradeId, topicId }
}

/** Materiál s hotovým textem — tak, jak ho po extrakci pošle prohlížeč. */
export async function seedMaterial(
  topicId: string,
  options: { fileName?: string; text?: string; excluded?: boolean; needsOcr?: boolean } = {},
): Promise<string> {
  const id = newId()
  const fileName = options.fileName ?? `${id}.txt`
  const text = options.text ?? 'Nějaký text materiálu. '.repeat(10)
  await db.insert(materials).values({
    id,
    schoolId: TEST_SKOLA_ID,
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

/** Otázka v bance. Výchozí je jednoduchý výběr z možností. */
export async function seedQuestion(
  topicId: string | null,
  options: {
    prompt?: string
    status?: 'draft' | 'approved' | 'rejected'
    /** Typ otázky — kvůli filtru podle typu; payload zůstává jednoduchý. */
    type?: QuestionType
    /** Ruční nastavení časů — testy řazení „od nejnovějších" potřebují jistotu pořadí. */
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
    schoolId: TEST_SKOLA_ID,
    createdBy: TEST_UCET_ID,
    topicId,
    materialId: null,
    type: options.type ?? 'single_choice',
    payload,
    blocks: [],
    points: 1,
    difficulty: 2,
    source: options.source ?? 'ai',
    status: options.status ?? 'approved',
    // Stejně jako v aplikaci: text pro hledání se plní při zápisu otázky.
    searchText: searchTextFor({ payload }),
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    ...(options.reviewedAt !== undefined ? { reviewedAt: options.reviewedAt } : {}),
  })
  return id
}
