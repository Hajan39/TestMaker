import { BUILT_IN_TEMPLATES } from '@testmaker/core/schema'
import { db, grades, materials, questions, subjects, templates, topics } from '@/db'
import { newId } from '@/lib/ids'

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

  await db.insert(subjects).values({ id: subjectId, name: options.subject ?? `Předmět ${subjectId}` })
  await db.insert(grades).values({ id: gradeId, subjectId, name: options.grade ?? '8. ročník' })
  await db.insert(topics).values({ id: topicId, gradeId, name: options.topic ?? `Téma ${topicId}` })

  return { subjectId, gradeId, topicId }
}

/** Materiál s hotovým textem — tak, jak ho po extrakci pošle prohlížeč. */
export async function seedMaterial(
  topicId: string,
  options: { fileName?: string; text?: string } = {},
): Promise<string> {
  const id = newId()
  const fileName = options.fileName ?? `${id}.txt`
  const text = options.text ?? 'Nějaký text materiálu. '.repeat(10)
  await db.insert(materials).values({
    id,
    topicId,
    fileName,
    relativePath: `Předmět/8. ročník/${fileName}`,
    mimeType: 'text/plain',
    sizeBytes: text.length,
    text,
    charCount: text.length,
    pageCount: null,
    needsOcr: false,
    contentHash: `hash-${id}`,
  })
  return id
}

/** Otázka v bance. Výchozí je jednoduchý výběr z možností. */
export async function seedQuestion(
  topicId: string | null,
  options: { prompt?: string; status?: 'draft' | 'approved' | 'rejected' } = {},
): Promise<string> {
  const id = newId()
  await db.insert(questions).values({
    id,
    topicId,
    materialId: null,
    type: 'single_choice',
    payload: {
      prompt: options.prompt ?? 'Kde probíhá výměna plynů?',
      options: ['V průdušnici', 'V plicních sklípcích'],
      correctIndex: 1,
    },
    blocks: [],
    points: 1,
    difficulty: 2,
    source: 'ai',
    status: options.status ?? 'approved',
  })
  return id
}
