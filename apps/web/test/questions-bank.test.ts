import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/questions/route'
import { POST as createTest } from '@/app/api/tests/route'
import { db, questions } from '@/db'
import { loadPickerTopics } from '@/lib/questionPicker'
import { loadTestItems } from '@/lib/tests'
import { jsonReq, req, seedMaterial, seedQuestion, seedTemplate, seedTopic, ACCOUNT } from './helpers'

/**
 * Question bank: search and filters are handled on the server and paging uses
 * a cursor. Previously all of the over a thousand questions were sent to the
 * browser with their content and searched there.
 */

interface Page {
  items: { id: string; status: string; type: string; topicId: string | null }[]
  nextCursor: string | null
  total: number
}

async function page(url: string): Promise<Page> {
  const response = await GET(req(url))
  expect(response.status).toBe(200)
  return (await response.json()) as Page
}

/** Walks the result by cursor to the end and returns ids in the order they came. */
async function readAll(url: string, limit: number): Promise<string[]> {
  const seen: string[] = []
  let cursor: string | null = null
  for (let guard = 0; guard < 50; guard += 1) {
    const separator = url.includes('?') ? '&' : '?'
    const data: Page = await page(
      `${url}${separator}limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    )
    seen.push(...data.items.map((item) => item.id))
    if (!data.nextCursor) return seen
    cursor = data.nextCursor
  }
  throw new Error('Paging did not reach the end')
}

describe('searching the bank', () => {
  it('finds a question by a word from its prompt even when written in capitals', async () => {
    const { topicId } = await seedTopic()
    const searched = await seedQuestion(topicId, { prompt: 'Čím dýchají ŽÁBRAMI ryby?' })
    await seedQuestion(topicId, { prompt: 'Kde roste kapradina?' })

    const data = await page(`/api/questions?q=${encodeURIComponent('žábrami')}`)
    expect(data.total).toBe(1)
    expect(data.items.map((item) => item.id)).toEqual([searched])
  })

  it('a percent sign in the search text is a character, not "anything"', async () => {
    const { topicId } = await seedTopic()
    const withPercent = await seedQuestion(topicId, { prompt: 'Kolik je 100 % z celku?' })
    await seedQuestion(topicId, { prompt: 'Otázka bez procent' })

    // Without escaping, `%` in `like` would mean "anything" and return both.
    const data = await page(`/api/questions?q=${encodeURIComponent('%')}`)
    expect(data.items.map((item) => item.id)).toEqual([withPercent])
  })

  it('an edited question is found by its new wording, not the original', async () => {
    const { topicId } = await seedTopic()
    const id = await seedQuestion(topicId, { prompt: 'Původní znění o houbách' })

    const patched = await PATCH(
      jsonReq('/api/questions', 'PATCH', {
        id,
        question: {
          type: 'single_choice',
          payload: { prompt: 'Nové znění o lišejnících', options: ['a', 'b'], correctIndex: 0 },
          blocks: [],
          points: 1,
          difficulty: 2,
        },
      }),
    )
    expect(patched.status).toBe(200)

    await expect(page(`/api/questions?q=${encodeURIComponent('lišejnících')}`)).resolves.toMatchObject({
      total: 1,
    })
    await expect(page(`/api/questions?q=${encodeURIComponent('houbách')}`)).resolves.toMatchObject({
      total: 0,
    })
  })
})

describe('filtry banky', () => {
  it('combine together — subject, type, status and text at once', async () => {
    const mine = await seedTopic()
    const other = await seedTopic()

    const searched = await seedQuestion(mine.topicId, {
      prompt: 'Sopka a láva: co vytéká z kráteru?',
      status: 'draft',
      type: 'single_choice',
    })
    // Each of the following violates exactly one filter condition.
    await seedQuestion(mine.topicId, { prompt: 'Sopka a láva', status: 'approved', type: 'single_choice' })
    await seedQuestion(mine.topicId, { prompt: 'Sopka a láva', status: 'draft', type: 'open' })
    await seedQuestion(mine.topicId, { prompt: 'Něco úplně jiného', status: 'draft', type: 'single_choice' })
    await seedQuestion(other.topicId, { prompt: 'Sopka a láva', status: 'draft', type: 'single_choice' })

    const data = await page(
      `/api/questions?subjectId=${mine.subjectId}&status=draft&type=single_choice&q=${encodeURIComponent('sopka')}`,
    )
    expect(data.total).toBe(1)
    expect(data.items.map((item) => item.id)).toEqual([searched])
  })

  it('narrowing to a grade and a topic goes through the library levels', async () => {
    const mine = await seedTopic()
    const other = await seedTopic()
    const id = await seedQuestion(mine.topicId, { prompt: 'Otázka v mém tématu' })
    await seedQuestion(other.topicId, { prompt: 'Otázka jinde' })

    await expect(page(`/api/questions?gradeId=${mine.gradeId}`)).resolves.toMatchObject({ total: 1 })
    const data = await page(`/api/questions?topicId=${mine.topicId}`)
    expect(data.items.map((item) => item.id)).toEqual([id])
  })
})

describe('paging the bank', () => {
  it('the cursor neither skips nor repeats a question and sticks to the filter', async () => {
    const { topicId, subjectId } = await seedTopic()
    const desired: string[] = []
    for (let i = 0; i < 17; i += 1) {
      const id = await seedQuestion(topicId, { prompt: `Koloběh vody ${i}`, status: 'draft' })
      desired.push(id)
    }
    // Questions not matching the filter — they must not get mixed into the paging.
    for (let i = 0; i < 5; i += 1) {
      await seedQuestion(topicId, { prompt: `Něco jiného ${i}`, status: 'approved' })
    }

    const url = `/api/questions?subjectId=${subjectId}&status=draft&q=${encodeURIComponent('koloběh')}`
    const first = await page(`${url}&limit=5`)
    expect(first.total).toBe(17)
    expect(first.items).toHaveLength(5)

    const seen = await readAll(url, 5)
    expect(new Set(seen).size, 'some question came twice').toBe(seen.length)
    expect([...seen].sort()).toEqual([...desired].sort())
  })

  it('the last page offers no further cursor', async () => {
    const { topicId } = await seedTopic()
    for (let i = 0; i < 3; i += 1) await seedQuestion(topicId, { prompt: `Kratičká ${i}` })

    const data = await page(`/api/questions?topicId=${topicId}&limit=5`)
    expect(data.items).toHaveLength(3)
    expect(data.nextCursor).toBeNull()
  })
})

describe('bulk actions in the bank', () => {
  it('approves the selected questions across subjects and leaves the rest alone', async () => {
    const mine = await seedTopic()
    const other = await seedTopic()
    const first = await seedQuestion(mine.topicId, { status: 'draft' })
    const second = await seedQuestion(other.topicId, { status: 'draft' })
    const untouched = await seedQuestion(mine.topicId, { status: 'draft' })

    const response = await PUT(
      jsonReq('/api/questions', 'PUT', { ids: [first, second], status: 'approved' }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ updated: 2 })

    const state = new Map(
      (await db.select({ id: questions.id, status: questions.status }).from(questions)).map((row) => [
        row.id,
        row.status,
      ]),
    )
    expect(state.get(first)).toBe('approved')
    expect(state.get(second)).toBe('approved')
    expect(state.get(untouched)).toBe('draft')
  })

  it('a rejection can be undone in groups by original status', async () => {
    const { topicId } = await seedTopic()
    const draft = await seedQuestion(topicId, { status: 'draft' })
    const approved = await seedQuestion(topicId, { status: 'approved' })

    await PUT(jsonReq('/api/questions', 'PUT', { ids: [draft, approved], status: 'rejected' }))
    // Exactly what the UI sends after clicking "Vzít zpět": each group
    // separately back to its original status.
    await PUT(jsonReq('/api/questions', 'PUT', { ids: [draft], status: 'draft' }))
    await PUT(jsonReq('/api/questions', 'PUT', { ids: [approved], status: 'approved' }))

    const [a] = await db.select({ status: questions.status }).from(questions).where(eq(questions.id, draft))
    const [b] = await db
      .select({ status: questions.status })
      .from(questions)
      .where(eq(questions.id, approved))
    expect(a?.status).toBe('draft')
    expect(b?.status).toBe('approved')
  })

  it('deletes the selected questions and leaves the rest of the bank alone', async () => {
    const { topicId } = await seedTopic()
    const deleted = await seedQuestion(topicId, { prompt: 'Tahle jde pryč' })
    const remains = await seedQuestion(topicId, { prompt: 'Tahle zůstává' })

    const response = await DELETE(req(`/api/questions?id=${encodeURIComponent(deleted)}`))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ deleted: 1 })

    const remaining = new Set((await db.select({ id: questions.id }).from(questions)).map((row) => row.id))
    expect(remaining.has(deleted)).toBe(false)
    expect(remaining.has(remains)).toBe(true)
  })
})

describe('deleting a question as a soft status', () => {
  it('rejects both questions and the test queue no longer offers them', async () => {
    const { topicId } = await seedTopic()
    const draft = await seedQuestion(topicId, { status: 'draft' })
    const approved = await seedQuestion(topicId, { status: 'approved' })

    const response = await PUT(
      jsonReq('/api/questions', 'PUT', { ids: [draft, approved], status: 'rejected' }),
    )
    expect(response.status).toBe(200)

    const state = new Map(
      (await db.select({ id: questions.id, status: questions.status }).from(questions)).map((row) => [
        row.id,
        row.status,
      ]),
    )
    expect(state.get(draft)).toBe('rejected')
    expect(state.get(approved)).toBe('rejected')

    const topics = await loadPickerTopics(ACCOUNT)
    const ids = topics.flatMap((topic) => topic.questions.map((question) => question.id))
    expect(ids).not.toContain(draft)
    expect(ids).not.toContain(approved)
  })

  it('undoing with two calls by original status returns a draft to draft and an approved one to approved', async () => {
    const { topicId } = await seedTopic()
    const draft = await seedQuestion(topicId, { status: 'draft' })
    const approved = await seedQuestion(topicId, { status: 'approved' })

    await PUT(jsonReq('/api/questions', 'PUT', { ids: [draft, approved], status: 'rejected' }))
    // Exactly what the client helper sends after clicking "Vrátit zpět": each
    // group separately back to its original status.
    await PUT(jsonReq('/api/questions', 'PUT', { ids: [draft], status: 'draft' }))
    await PUT(jsonReq('/api/questions', 'PUT', { ids: [approved], status: 'approved' }))

    const [a] = await db.select({ status: questions.status }).from(questions).where(eq(questions.id, draft))
    const [b] = await db
      .select({ status: questions.status })
      .from(questions)
      .where(eq(questions.id, approved))
    expect(a?.status).toBe('draft')
    expect(b?.status).toBe('approved')
  })

  it('a question used in a saved test is deleted from the bank, but the test still prints it from its snapshot', async () => {
    const templateId = await seedTemplate()
    const { topicId } = await seedTopic()
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka v písemce', status: 'approved' })

    const emptyHeader = { school: '', subject: '', className: '', teacher: '', date: '', note: '' }
    const createResponse = await createTest(
      jsonReq('/api/tests', 'POST', {
        title: 'Písemka',
        description: null,
        graded: true,
        templateId,
        header: emptyHeader,
        variants: 1,
        showKey: true,
        items: [{ kind: 'question', questionId }],
      }),
    )
    expect(createResponse.status).toBe(200)
    const { id: testId } = (await createResponse.json()) as { id: string }

    const before = await loadTestItems(ACCOUNT, testId)
    const snapshotBefore = before[0]?.questionSnapshot

    await PUT(jsonReq('/api/questions', 'PUT', { ids: [questionId], status: 'rejected' }))

    const [row] = await db.select({ status: questions.status }).from(questions).where(eq(questions.id, questionId))
    expect(row?.status).toBe('rejected')

    const after = await loadTestItems(ACCOUNT, testId)
    expect(after[0]?.questionSnapshot).toEqual(snapshotBefore)
    expect(after[0]?.question?.payload).toMatchObject({ prompt: 'Otázka v písemce' })
  })
})

describe('question origin', () => {
  /** Creates a question with origin evidence and returns its database row. */
  async function createWithEvidence(topicId: string, fileName: string) {
    const response = await POST(
      jsonReq('/api/questions', 'POST', {
        topicId,
        question: {
          type: 'short_answer',
          difficulty: 1,
          points: 1,
          blocks: [],
          payload: { prompt: 'Čím krmí savci mláďata?', answer: 'mateřským mlékem' },
          evidence: { fileName, quote: 'mláďata krmí mateřským mlékem' },
        },
      }),
    )
    expect(response.status).toBe(200)
    const { id } = (await response.json()) as { id: string }
    const [row] = await db.select().from(questions).where(eq(questions.id, id)).limit(1)
    return row
  }

  it('the material the question came from is found by the file name in its evidence', async () => {
    const { topicId } = await seedTopic()
    const materialId = await seedMaterial(topicId, { fileName: 'Savci.pdf' })

    expect((await createWithEvidence(topicId, 'Savci.pdf'))?.materialId).toBe(materialId)
  })

  it("a name that isn't in the topic doesn't invent a link", async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'Savci.pdf' })

    expect((await createWithEvidence(topicId, 'Ptáci.pdf'))?.materialId).toBeNull()
  })

  it('with two materials of the same name the link stays empty instead of guessing', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'Savci.pdf' })
    await seedMaterial(topicId, { fileName: 'Savci.pdf' })

    expect((await createWithEvidence(topicId, 'Savci.pdf'))?.materialId).toBeNull()
  })
})
