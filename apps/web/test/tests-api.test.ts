import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { DELETE, GET, POST, PUT } from '@/app/api/tests/route'
import { db, grades, questions, schools, subjects, testItems, users } from '@/db'
import { newId } from '@/lib/ids'
import { loadTest, loadTestItems } from '@/lib/tests'
import { jsonReq, req, seedQuestion, seedTemplate, seedTopic, UCET } from './helpers'

let templateId: string
let topicId: string
let gradeId: string

const CIZI_SKOLA = 'skola-ciziho-mesta-testy'

/** Ročník z úplně jiné školy — cizí věc se má tvářit jako neexistující. */
async function ciziRocnik(): Promise<string> {
  await db
    .insert(schools)
    .values({ id: CIZI_SKOLA, name: 'Jiná škola', slug: 'jina-testy' })
    .onConflictDoNothing()
  const cizaUcitelka = newId()
  await db.insert(users).values({
    id: cizaUcitelka,
    schoolId: CIZI_SKOLA,
    email: `${cizaUcitelka}@jina.cz`,
    name: 'Cizí učitelka',
    role: 'spravce',
  })
  const subjectId = newId()
  const cizGradeId = newId()
  await db.insert(subjects).values({ id: subjectId, schoolId: CIZI_SKOLA, name: 'Cizí předmět' })
  await db.insert(grades).values({ id: cizGradeId, schoolId: CIZI_SKOLA, subjectId, name: 'Cizí ročník' })
  return cizGradeId
}

beforeAll(async () => {
  templateId = await seedTemplate()
  const topic = await seedTopic()
  topicId = topic.topicId
  gradeId = topic.gradeId
})

const emptyHeader = { school: '', subject: '', className: '', teacher: '', date: '', note: '' }

/** Uloží nový test a vrátí jeho id. */
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

/** Položky testu tak, jak je pošle klient při přeuložení (i s id z databáze). */
async function itemsForSave(testId: string) {
  return (await loadTestItems(UCET, testId)).map((item) => ({
    id: item.id,
    kind: item.kind,
    questionId: item.questionId,
    text: item.text,
    pointsOverride: item.pointsOverride,
    linesOverride: item.linesOverride,
  }))
}

describe('ukládání testu', () => {
  it('uloží test i s položkami a zachová jejich pořadí', async () => {
    const first = await seedQuestion(topicId, { prompt: 'První otázka' })
    const second = await seedQuestion(topicId, { prompt: 'Druhá otázka' })

    const id = await createTest([
      { kind: 'heading', text: 'Část A' },
      { kind: 'question', questionId: first },
      { kind: 'page_break' },
      { kind: 'question', questionId: second },
    ])

    const test = await loadTest(UCET, id)
    expect(test?.title).toBe('Písemka')
    expect(test?.templateId).toBe(templateId)

    const items = await loadTestItems(UCET, id)
    expect(items.map((item) => item.kind)).toEqual(['heading', 'question', 'page_break', 'question'])
    expect(items.map((item) => item.order)).toEqual([0, 1, 2, 3])
    expect(items[1]?.questionId).toBe(first)
    expect(items[3]?.questionId).toBe(second)
  })

  it('zmrazí obsah otázky při zařazení do testu', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Původní znění' })
    const id = await createTest([{ kind: 'question', questionId }])

    const [item] = await loadTestItems(UCET, id)
    expect(item?.questionSnapshot).toBeTruthy()
    expect(item?.question?.payload).toMatchObject({ prompt: 'Původní znění' })
  })

  it('u nadpisu ani zalomení se nic nezmrazuje', async () => {
    const id = await createTest([{ kind: 'heading', text: 'Část A' }, { kind: 'page_break' }])
    const items = await loadTestItems(UCET, id)
    expect(items.every((item) => item.questionSnapshot === null)).toBe(true)
    expect(items[0]?.text).toBe('Část A')
  })

  it('odmítne test bez názvu', async () => {
    const response = await POST(
      jsonReq('/api/tests', 'POST', {
        title: '',
        templateId,
        header: emptyHeader,
        items: [],
      }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'Neplatná data' })
  })

  it('odmítne nesmyslný počet linek u položky', async () => {
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

  it('v seznamu testů je i počet položek', async () => {
    const id = await createTest([{ kind: 'heading', text: 'Část A' }, { kind: 'page_break' }])
    const { tests } = (await (await GET(req('/api/tests'))).json()) as {
      tests: { id: string; itemCount: number; templateName: string }[]
    }
    const row = tests.find((test) => test.id === id)
    expect(row?.itemCount).toBe(2)
    expect(row?.templateName).toBeTruthy()
  })
})

describe('přeuložení testu', () => {
  /** Přeuloží test se stejnými daty, jen s jiným názvem. */
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

  it('nepřepíše zmrazený obsah, když se otázka v bance mezitím změní', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Znění při zařazení' })
    const id = await createTest([{ kind: 'question', questionId }])

    // Učitelka otázku v bance přepíše — už vytištěná písemka se tím měnit nesmí.
    await db
      .update(questions)
      .set({ payload: { prompt: 'Změněné znění', options: ['a', 'b'], correctIndex: 0 } })
      .where(eq(questions.id, questionId))

    await resave(id, await itemsForSave(id))

    const [item] = await loadTestItems(UCET, id)
    expect(item?.question?.payload).toMatchObject({ prompt: 'Znění při zařazení' })
    // Rozhraní má o rozdílu vědět, aby ho mohlo učitelce ukázat.
    expect(item?.questionEdited).toBe(true)
  })

  it('otázka přidaná až při přeuložení se zmrazí v aktuálním znění', async () => {
    const first = await seedQuestion(topicId, { prompt: 'První' })
    const id = await createTest([{ kind: 'question', questionId: first }])

    const second = await seedQuestion(topicId, { prompt: 'Přidaná až teď' })
    await resave(id, [...(await itemsForSave(id)), { kind: 'question', questionId: second }])

    const items = await loadTestItems(UCET, id)
    expect(items).toHaveLength(2)
    expect(items[1]?.question?.payload).toMatchObject({ prompt: 'Přidaná až teď' })
  })

  it('změní pořadí položek podle toho, jak přišly', async () => {
    const first = await seedQuestion(topicId, { prompt: 'A' })
    const second = await seedQuestion(topicId, { prompt: 'B' })
    const id = await createTest([
      { kind: 'question', questionId: first },
      { kind: 'question', questionId: second },
    ])

    const saved = await itemsForSave(id)
    await resave(id, [saved[1], saved[0]])

    const items = await loadTestItems(UCET, id)
    expect(items.map((item) => item.questionId)).toEqual([second, first])
    expect(items.map((item) => item.order)).toEqual([0, 1])
  })

  it('položka otázky, která z banky zmizela, si obsah udrží i po přeuložení', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka, co zmizí' })
    const id = await createTest([{ kind: 'question', questionId }])

    await db.delete(questions).where(eq(questions.id, questionId))

    const afterDelete = await loadTestItems(UCET, id)
    expect(afterDelete[0]?.questionMissing).toBe(true)
    expect(afterDelete[0]?.question?.payload).toMatchObject({ prompt: 'Otázka, co zmizí' })

    // Cizí klíč je `set null`, takže po smazání otázky zbyde jen snímek.
    await resave(id, await itemsForSave(id))

    const items = await loadTestItems(UCET, id)
    expect(items[0]?.question?.payload).toMatchObject({ prompt: 'Otázka, co zmizí' })
  })

  it('přepíše i hlavičku a název testu', async () => {
    const id = await createTest([])
    await resave(id, [], { header: { ...emptyHeader, school: 'ZŠ Ukázková', className: '8.A' } })

    const test = await loadTest(UCET, id)
    expect(test?.title).toBe('Přejmenovaná písemka')
    expect(test?.header).toMatchObject({ school: 'ZŠ Ukázková', className: '8.A' })
  })
})

describe('ročník testu', () => {
  it('uloží ročník téže školy', async () => {
    const id = await createTest([], { gradeId })
    const test = await loadTest(UCET, id)
    expect(test?.gradeId).toBe(gradeId)
  })

  it('cizí ročník uloží jako null a odpověď se neliší', async () => {
    const cizi = await ciziRocnik()
    const response = await POST(
      jsonReq('/api/tests', 'POST', {
        title: 'Písemka',
        description: null,
        graded: true,
        templateId,
        gradeId: cizi,
        header: emptyHeader,
        variants: 1,
        showKey: true,
        items: [],
      }),
    )
    expect(response.status).toBe(200)
    const { id } = (await response.json()) as { id: string }
    const test = await loadTest(UCET, id)
    expect(test?.gradeId).toBeNull()
  })

  it('neexistující ročník uloží jako null', async () => {
    const id = await createTest([], { gradeId: 'rocnik-ktery-neni' })
    const test = await loadTest(UCET, id)
    expect(test?.gradeId).toBeNull()
  })

  it('přeuložení zachová i změní ročník', async () => {
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
    expect((await loadTest(UCET, id))?.gradeId).toBe(gradeId)

    const jinyTopic = await seedTopic()
    await PUT(
      jsonReq('/api/tests', 'PUT', {
        id,
        title: 'Přejmenovaná písemka',
        description: null,
        graded: true,
        templateId,
        gradeId: jinyTopic.gradeId,
        header: emptyHeader,
        variants: 1,
        showKey: true,
        items: [],
      }),
    )
    expect((await loadTest(UCET, id))?.gradeId).toBe(jinyTopic.gradeId)
  })

  it('smazání ročníku test nesmaže, jen mu vezme vazbu', async () => {
    const jinyTopic = await seedTopic()
    const id = await createTest([], { gradeId: jinyTopic.gradeId })

    await db.delete(grades).where(eq(grades.id, jinyTopic.gradeId))

    const test = await loadTest(UCET, id)
    expect(test).not.toBeNull()
    expect(test?.gradeId).toBeNull()
  })
})

describe('mazání testu', () => {
  it('smaže test i jeho položky', async () => {
    const questionId = await seedQuestion(topicId)
    const id = await createTest([{ kind: 'question', questionId }])

    const response = await DELETE(req(`/api/tests?id=${encodeURIComponent(id)}`, { method: 'DELETE' }))
    expect(response.status).toBe(200)

    expect(await loadTest(UCET, id)).toBeNull()
    const rows = await db.select().from(testItems).where(eq(testItems.testId, id))
    expect(rows).toHaveLength(0)
  })

  it('bez id odmítne mazat', async () => {
    const response = await DELETE(req('/api/tests', { method: 'DELETE' }))
    expect(response.status).toBe(400)
  })
})
