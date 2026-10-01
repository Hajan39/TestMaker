import { describe, expect, it } from 'vitest'
import { GET, PUT } from '@/app/api/questions/route'
import { db, questions } from '@/db'
import { jsonReq, req, seedQuestion, seedTopic } from './helpers'

interface Page {
  items: { id: string; status: string; topicId: string | null }[]
  nextCursor: string | null
  total: number
}

async function page(url: string): Promise<Page> {
  const response = await GET(req(url))
  expect(response.status).toBe(200)
  return (await response.json()) as Page
}

/** Walks the queue by cursor to the end and returns ids in the order they came. */
async function readAll(base: string, limit: number, startCursor: string | null = null): Promise<string[]> {
  const seen: string[] = []
  let cursor: string | null = startCursor
  for (let guard = 0; guard < 50; guard += 1) {
    const url: string = `${base}&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    const data: Page = await page(url)
    seen.push(...data.items.map((item) => item.id))
    if (!data.nextCursor) return seen
    cursor = data.nextCursor
  }
  throw new Error('Paging did not reach the end')
}

describe('cursor paging of the queue', () => {
  it('over mixed statuses neither skips nor repeats a question', async () => {
    const { topicId } = await seedTopic()
    const drafts: string[] = []
    for (let i = 0; i < 17; i += 1) {
      // Alternating draft and approved question — the queue may see only drafts.
      const status = i % 3 === 0 ? 'approved' : 'draft'
      const id = await seedQuestion(topicId, { prompt: `Otázka ${i}`, status })
      if (status === 'draft') drafts.push(id)
    }

    const seen = await readAll(`/api/questions?status=draft&topicId=${topicId}`, 5)

    expect(new Set(seen).size, 'some question came twice').toBe(seen.length)
    expect([...seen].sort()).toEqual([...drafts].sort())
  })

  it('approving while browsing does not shift the rest of the queue (an offset would skip)', async () => {
    const { topicId } = await seedTopic()
    const drafts: string[] = []
    for (let i = 0; i < 12; i += 1) {
      drafts.push(await seedQuestion(topicId, { prompt: `Koncept ${i}`, status: 'draft' }))
    }

    const first = await page(`/api/questions?status=draft&topicId=${topicId}&limit=4`)
    expect(first.total).toBe(12)
    expect(first.items).toHaveLength(4)

    // Exactly what the teacher does in the queue: approves the first four, so
    // they drop out of the filter result. With an offset the next page would
    // start at the ninth question and four drafts would never be seen.
    const approved = first.items.map((item) => item.id)
    const put = await PUT(jsonReq('/api/questions', 'PUT', { ids: approved, status: 'approved' }))
    expect(put.status).toBe(200)

    // Continue with the cursor past the first page — as a queue window that
    // ran out of loaded questions would.
    const rest = await readAll(`/api/questions?status=draft&topicId=${topicId}`, 4, first.nextCursor)

    const remainingIds = drafts.filter((id) => !approved.includes(id))
    expect(new Set(rest).size, 'some question came twice').toBe(rest.length)
    expect([...rest].sort()).toEqual([...remainingIds].sort())
  })

  it('the topic filter keeps questions from elsewhere out of the queue', async () => {
    const mine = await seedTopic()
    const other = await seedTopic()
    const id = await seedQuestion(mine.topicId, { status: 'draft' })
    await seedQuestion(other.topicId, { status: 'draft' })

    const data = await page(`/api/questions?status=draft&topicId=${mine.topicId}`)
    expect(data.total).toBe(1)
    expect(data.items.map((item) => item.id)).toEqual([id])
  })

  it('narrowing to a grade and a subject goes through the library levels', async () => {
    const mine = await seedTopic()
    const other = await seedTopic()
    await seedQuestion(mine.topicId, { status: 'draft' })
    await seedQuestion(other.topicId, { status: 'draft' })

    const byGrade = await page(`/api/questions?status=draft&gradeId=${mine.gradeId}`)
    expect(byGrade.total).toBe(1)

    const bySubject = await page(`/api/questions?status=draft&subjectId=${mine.subjectId}`)
    expect(bySubject.total).toBe(1)
  })
})

describe('"Smazané" panel — newest first with more than twenty items', () => {
  it('sorts by reviewedAt descending and the cursor walks the whole list without repeats', async () => {
    const { topicId } = await seedTopic()
    // 22 deleted questions, each with its own `reviewedAt` — index 0 is the
    // oldest change, index 21 the newest, so the expected order is
    // descending 21, 20, …, 0.
    const ids: string[] = []
    for (let i = 0; i < 22; i += 1) {
      ids.push(
        await seedQuestion(topicId, {
          prompt: `Smazaná otázka ${i}`,
          status: 'rejected',
          reviewedAt: new Date(2026, 0, 1, 0, 0, i).toISOString(),
        }),
      )
    }

    const first = await page(`/api/questions?status=rejected&topicId=${topicId}&order=desc`)
    expect(first.total).toBe(22)
    expect(first.items).toHaveLength(20)
    expect(first.items[0].id).toBe(ids[21])
    expect(first.items[19].id).toBe(ids[2])
    expect(first.nextCursor).toBeTruthy()

    const rest = await page(
      `/api/questions?status=rejected&topicId=${topicId}&order=desc&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
    expect(rest.items.map((item) => item.id)).toEqual([ids[1], ids[0]])
    expect(rest.nextCursor).toBeNull()

    const seen = [...first.items, ...rest.items].map((item) => item.id)
    expect(new Set(seen).size).toBe(22)
    expect(seen).toEqual([...ids].reverse())
  })
})

describe('bulk approval of a whole topic', () => {
  it("changes only the topic's drafts and returns their ids for undo", async () => {
    const mine = await seedTopic()
    const other = await seedTopic()

    const draftA = await seedQuestion(mine.topicId, { status: 'draft' })
    const draftB = await seedQuestion(mine.topicId, { status: 'draft' })
    const alreadyApproved = await seedQuestion(mine.topicId, { status: 'approved' })
    const rejected = await seedQuestion(mine.topicId, { status: 'rejected' })
    const foreignDraft = await seedQuestion(other.topicId, { status: 'draft' })

    const response = await PUT(
      jsonReq('/api/questions', 'PUT', { topicId: mine.topicId, from: 'draft', status: 'approved' }),
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { updated: number; ids: string[] }
    expect(body.updated).toBe(2)
    expect([...body.ids].sort()).toEqual([draftA, draftB].sort())

    const rows = await db.select({ id: questions.id, status: questions.status }).from(questions)
    const state = new Map(rows.map((row) => [row.id, row.status]))
    expect(state.get(draftA)).toBe('approved')
    expect(state.get(draftB)).toBe('approved')
    // What was approved or rejected before must not be touched by the action —
    // otherwise "Vzít zpět" would return other people's work to drafts too.
    expect(state.get(alreadyApproved)).toBe('approved')
    expect(state.get(rejected)).toBe('rejected')
    expect(state.get(foreignDraft)).toBe('draft')
  })

  it('a topic without drafts changes nothing and says so with zero', async () => {
    const { topicId } = await seedTopic()
    await seedQuestion(topicId, { status: 'approved' })
    const response = await PUT(
      jsonReq('/api/questions', 'PUT', { topicId, from: 'draft', status: 'approved' }),
    )
    await expect(response.json()).resolves.toMatchObject({ updated: 0, ids: [] })
  })
})
