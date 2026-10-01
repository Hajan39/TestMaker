import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { DELETE, GET, POST, PUT } from '@/app/api/tests/route'
import { db, grades, questions, schools, subjects, testItems, users } from '@/db'
import { newId } from '@/lib/ids'
import { loadTest, loadTestItems } from '@/lib/tests'
import { jsonReq, req, seedQuestion, seedTemplate, seedTopic, ACCOUNT } from './helpers'

let templateId: string
let topicId: string
let gradeId: string

const FOREIGN_SCHOOL = 'skola-ciziho-mesta-testy'

/** A grade from a completely different school — a foreign item must look nonexistent. */
async function foreignGrade(): Promise<string> {
  await db
    .insert(schools)
    .values({ id: FOREIGN_SCHOOL, name: 'Jiná škola', slug: 'jina-testy' })
    .onConflictDoNothing()
  const foreignTeacher = newId()
  await db.insert(users).values({
    id: foreignTeacher,
    schoolId: FOREIGN_SCHOOL,
    email: `${foreignTeacher}@jina.cz`,
    name: 'Cizí učitelka',
    role: 'spravce',
  })
  const subjectId = newId()
  const foreignGradeId = newId()
  await db.insert(subjects).values({ id: subjectId, schoolId: FOREIGN_SCHOOL, name: 'Cizí předmět' })
  await db.insert(grades).values({ id: foreignGradeId, schoolId: FOREIGN_SCHOOL, subjectId, name: 'Cizí ročník' })
  return foreignGradeId
}

beforeAll(async () => {
  templateId = await seedTemplate()
  const topic = await seedTopic()
  topicId = topic.topicId
  gradeId = topic.gradeId
})

const emptyHeader = { school: '', subject: '', className: '', teacher: '', date: '', note: '' }

/** Saves a new test and returns its id. */
async function createTest(items: unknown[], overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await POST(
    jsonReq('/api/tests', 'POST', {
      title: 'Písemka',
      description: null,
      graded: true,
      templateId,
      header: emptyHeader,
      variants: 1,
      showKey: true,
      items,
      ...overrides,
    }),
  )
  expect(response.status).toBe(200)
  const { id } = (await response.json()) as { id: string }
  return id
}

/** Test items as the client sends them on re-save (including database ids). */
async function itemsForSave(testId: string) {
  return (await loadTestItems(ACCOUNT, testId)).map((item) => ({
    id: item.id,
    kind: item.kind,
    questionId: item.questionId,
    text: item.text,
    pointsOverride: item.pointsOverride,
    linesOverride: item.linesOverride,
  }))
}

describe('saving a test', () => {
  it('saves the test with its items and keeps their order', async () => {
    const first = await seedQuestion(topicId, { prompt: 'První otázka' })
    const second = await seedQuestion(topicId, { prompt: 'Druhá otázka' })

    const id = await createTest([
      { kind: 'heading', text: 'Část A' },
      { kind: 'question', questionId: first },
      { kind: 'page_break' },
      { kind: 'question', questionId: second },
    ])

    const test = await loadTest(ACCOUNT, id)
    expect(test?.title).toBe('Písemka')
    expect(test?.templateId).toBe(templateId)

    const items = await loadTestItems(ACCOUNT, id)
    expect(items.map((item) => item.kind)).toEqual(['heading', 'question', 'page_break', 'question'])
    expect(items.map((item) => item.order)).toEqual([0, 1, 2, 3])
    expect(items[1]?.questionId).toBe(first)
    expect(items[3]?.questionId).toBe(second)
  })

  it('freezes the question content when adding it to the test', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Původní znění' })
    const id = await createTest([{ kind: 'question', questionId }])

    const [item] = await loadTestItems(ACCOUNT, id)
    expect(item?.questionSnapshot).toBeTruthy()
    expect(item?.question?.payload).toMatchObject({ prompt: 'Původní znění' })
  })

  it('freezes nothing for a heading or page break', async () => {
    const id = await createTest([{ kind: 'heading', text: 'Část A' }, { kind: 'page_break' }])
    const items = await loadTestItems(ACCOUNT, id)
    expect(items.every((item) => item.questionSnapshot === null)).toBe(true)
    expect(items[0]?.text).toBe('Část A')
  })

  it('rejects a test without a title', async () => {
    const response = await POST(
      jsonReq('/api/tests', 'POST', {
        title: '',
        templateId,
        header: emptyHeader,
        items: [],
      }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('chybí název') })
  })

  it('rejects a nonsensical line count on an item', async () => {
    const response = await POST(
      jsonReq('/api/tests', 'POST', {
        title: 'Písemka',
        templateId,
        header: emptyHeader,
        items: [{ kind: 'question', questionId: 'q', linesOverride: 999 }],
      }),
    )
    expect(response.status).toBe(400)
  })

  it('the test list includes the item count', async () => {
    const id = await createTest([{ kind: 'heading', text: 'Část A' }, { kind: 'page_break' }])
    const { tests } = (await (await GET(req('/api/tests'))).json()) as {
      tests: { id: string; itemCount: number; templateName: string }[]
    }
    const row = tests.find((test) => test.id === id)
    expect(row?.itemCount).toBe(2)
    expect(row?.templateName).toBeTruthy()
  })

  it('gradeId in the query narrows the list to tests of that class', async () => {
    const otherTopic = await seedTopic()
    const ownGradeId = await createTest([], { gradeId })
    const otherGradeId = await createTest([], { gradeId: otherTopic.gradeId })

    const { tests } = (await (await GET(req(`/api/tests?gradeId=${gradeId}`))).json()) as {
      tests: { id: string }[]
    }
    expect(tests.some((test) => test.id === ownGradeId)).toBe(true)
    expect(tests.some((test) => test.id === otherGradeId)).toBe(false)
  })
})

describe('re-saving a test', () => {
  /** Re-saves the test with the same data, only with a different title. */
  async function resave(id: string, items: unknown[], overrides: Record<string, unknown> = {}) {
    const response = await PUT(
      jsonReq('/api/tests', 'PUT', {
        id,
        title: 'Přejmenovaná písemka',
        description: null,
        graded: true,
        templateId,
        header: emptyHeader,
        variants: 1,
        showKey: true,
        items,
        ...overrides,
      }),
    )
    expect(response.status).toBe(200)
  }

  it('does not overwrite frozen content when the bank question changes meanwhile', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Znění při zařazení' })
    const id = await createTest([{ kind: 'question', questionId }])

    // The teacher rewrites the question in the bank — an already printed test must not change.
    await db
      .update(questions)
      .set({ payload: { prompt: 'Změněné znění', options: ['a', 'b'], correctIndex: 0 } })
      .where(eq(questions.id, questionId))

    await resave(id, await itemsForSave(id))

    const [item] = await loadTestItems(ACCOUNT, id)
    expect(item?.question?.payload).toMatchObject({ prompt: 'Znění při zařazení' })
    // The UI should know about the difference so it can show it to the teacher.
    expect(item?.questionEdited).toBe(true)
  })

  it('returns item ids and keeps frozen content with them on the next save', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Znění při zařazení' })
    const id = await createTest([{ kind: 'question', questionId }])
    const saved = await itemsForSave(id)

    await db
      .update(questions)
      .set({ payload: { prompt: 'Změněné znění', options: ['a', 'b'], correctIndex: 0 } })
      .where(eq(questions.id, questionId))

    // After saving, the editor sends the ids returned by the previous save.
    const body = { id, title: 'x', description: null, graded: true, templateId, header: emptyHeader, variants: 1, showKey: true }
    const first = await PUT(jsonReq('/api/tests', 'PUT', { ...body, items: saved }))
    const { itemIds } = (await first.json()) as { itemIds: string[] }
    expect(itemIds).toEqual(saved.map((item) => (item as { id: string }).id))
    await PUT(jsonReq('/api/tests', 'PUT', { ...body, items: saved.map((item, i) => ({ ...(item as object), id: itemIds[i] })) }))

    const [item] = await loadTestItems(ACCOUNT, id)
    expect(item?.question?.payload).toMatchObject({ prompt: 'Znění při zařazení' })
  })

  it('a question added on re-save is frozen in its current wording', async () => {
    const first = await seedQuestion(topicId, { prompt: 'První' })
    const id = await createTest([{ kind: 'question', questionId: first }])

    const second = await seedQuestion(topicId, { prompt: 'Přidaná až teď' })
    await resave(id, [...(await itemsForSave(id)), { kind: 'question', questionId: second }])

    const items = await loadTestItems(ACCOUNT, id)
    expect(items).toHaveLength(2)
    expect(items[1]?.question?.payload).toMatchObject({ prompt: 'Přidaná až teď' })
  })

  it('reorders items in the order they arrived', async () => {
    const first = await seedQuestion(topicId, { prompt: 'A' })
    const second = await seedQuestion(topicId, { prompt: 'B' })
    const id = await createTest([
      { kind: 'question', questionId: first },
      { kind: 'question', questionId: second },
    ])

    const saved = await itemsForSave(id)
    await resave(id, [saved[1], saved[0]])

    const items = await loadTestItems(ACCOUNT, id)
    expect(items.map((item) => item.questionId)).toEqual([second, first])
    expect(items.map((item) => item.order)).toEqual([0, 1])
  })

  it('an item of a question that disappeared from the bank keeps its content after re-save', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka, co zmizí' })
    const id = await createTest([{ kind: 'question', questionId }])

    await db.delete(questions).where(eq(questions.id, questionId))

    const afterDelete = await loadTestItems(ACCOUNT, id)
    expect(afterDelete[0]?.questionMissing).toBe(true)
    expect(afterDelete[0]?.question?.payload).toMatchObject({ prompt: 'Otázka, co zmizí' })

    // The foreign key is `set null`, so only the snapshot remains after the question is deleted.
    await resave(id, await itemsForSave(id))

    const items = await loadTestItems(ACCOUNT, id)
    expect(items[0]?.question?.payload).toMatchObject({ prompt: 'Otázka, co zmizí' })
  })

  it('keeps the class without gradeId in the body (older client that omits the field)', async () => {
    const id = await createTest([], { gradeId })

    // `resave` without `gradeId` in `overrides` leaves the field out of the body —
    // exactly as the editor used to send it. A missing field must not clear the
    // class; only an explicit `gradeId: null` may clear it.
    await resave(id, [])

    expect((await loadTest(ACCOUNT, id))?.gradeId).toBe(gradeId)
  })

  it('overwrites the header and title of the test too', async () => {
    const id = await createTest([])
    await resave(id, [], { header: { ...emptyHeader, school: 'ZŠ Ukázková', className: '8.A' } })

    const test = await loadTest(ACCOUNT, id)
    expect(test?.title).toBe('Přejmenovaná písemka')
    expect(test?.header).toMatchObject({ school: 'ZŠ Ukázková', className: '8.A' })
  })
})

describe('test grade', () => {
  it('saves a grade of the same school', async () => {
    const id = await createTest([], { gradeId })
    const test = await loadTest(ACCOUNT, id)
    expect(test?.gradeId).toBe(gradeId)
  })

  it('saves a foreign grade as null and the response does not differ', async () => {
    const foreign = await foreignGrade()
    const response = await POST(
      jsonReq('/api/tests', 'POST', {
        title: 'Písemka',
        description: null,
        graded: true,
        templateId,
        gradeId: foreign,
        header: emptyHeader,
        variants: 1,
        showKey: true,
        items: [],
      }),
    )
    expect(response.status).toBe(200)
    const { id } = (await response.json()) as { id: string }
    const test = await loadTest(ACCOUNT, id)
    expect(test?.gradeId).toBeNull()
  })

  it('saves a nonexistent grade as null', async () => {
    const id = await createTest([], { gradeId: 'rocnik-ktery-neni' })
    const test = await loadTest(ACCOUNT, id)
    expect(test?.gradeId).toBeNull()
  })

  it('re-saving both keeps and changes the grade', async () => {
    const id = await createTest([], { gradeId })
    await PUT(
      jsonReq('/api/tests', 'PUT', {
        id,
        title: 'Přejmenovaná písemka',
        description: null,
        graded: true,
        templateId,
        gradeId,
        header: emptyHeader,
        variants: 1,
        showKey: true,
        items: [],
      }),
    )
    expect((await loadTest(ACCOUNT, id))?.gradeId).toBe(gradeId)

    const otherTopic = await seedTopic()
    await PUT(
      jsonReq('/api/tests', 'PUT', {
        id,
        title: 'Přejmenovaná písemka',
        description: null,
        graded: true,
        templateId,
        gradeId: otherTopic.gradeId,
        header: emptyHeader,
        variants: 1,
        showKey: true,
        items: [],
      }),
    )
    expect((await loadTest(ACCOUNT, id))?.gradeId).toBe(otherTopic.gradeId)
  })

  it('deleting a grade does not delete the test, only unlinks it', async () => {
    const otherTopic = await seedTopic()
    const id = await createTest([], { gradeId: otherTopic.gradeId })

    await db.delete(grades).where(eq(grades.id, otherTopic.gradeId))

    const test = await loadTest(ACCOUNT, id)
    expect(test).not.toBeNull()
    expect(test?.gradeId).toBeNull()
  })
})

describe('deleting a test', () => {
  it('deletes the test and its items', async () => {
    const questionId = await seedQuestion(topicId)
    const id = await createTest([{ kind: 'question', questionId }])

    const response = await DELETE(req(`/api/tests?id=${encodeURIComponent(id)}`, { method: 'DELETE' }))
    expect(response.status).toBe(200)

    expect(await loadTest(ACCOUNT, id)).toBeNull()
    const rows = await db.select().from(testItems).where(eq(testItems.testId, id))
    expect(rows).toHaveLength(0)
  })

  it('a nonexistent test reports 404, not success', async () => {
    const response = await DELETE(req('/api/tests?id=neexistuje', { method: 'DELETE' }))
    expect(response.status).toBe(404)
  })

  it('refuses to delete without an id', async () => {
    const response = await DELETE(req('/api/tests', { method: 'DELETE' }))
    expect(response.status).toBe(400)
  })
})
