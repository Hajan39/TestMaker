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

/** Projde frontu kurzorem až do konce a vrátí id v pořadí, v jakém přišla. */
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
  throw new Error('Stránkování nedojelo do konce')
}

describe('stránkování fronty kurzorem', () => {
  it('nad smíšenými stavy nevynechá ani nezopakuje otázku', async () => {
    const { topicId } = await seedTopic()
    const drafts: string[] = []
    for (let i = 0; i < 17; i += 1) {
      // Střídavě koncept a schválená otázka — fronta smí vidět jen koncepty.
      const status = i % 3 === 0 ? 'approved' : 'draft'
      const id = await seedQuestion(topicId, { prompt: `Otázka ${i}`, status })
      if (status === 'draft') drafts.push(id)
    }

    const seen = await readAll(`/api/questions?status=draft&topicId=${topicId}`, 5)

    expect(new Set(seen).size, 'některá otázka přišla dvakrát').toBe(seen.length)
    expect([...seen].sort()).toEqual([...drafts].sort())
  })

  it('schválením během procházení se zbytek fronty neposune (offset by přeskakoval)', async () => {
    const { topicId } = await seedTopic()
    const drafts: string[] = []
    for (let i = 0; i < 12; i += 1) {
      drafts.push(await seedQuestion(topicId, { prompt: `Koncept ${i}`, status: 'draft' }))
    }

    const first = await page(`/api/questions?status=draft&topicId=${topicId}&limit=4`)
    expect(first.total).toBe(12)
    expect(first.items).toHaveLength(4)

    // Přesně to, co dělá učitelka ve frontě: první čtyři schválí, takže
    // z výsledku filtru vypadnou. S offsetem by další stránka začala až
    // u deváté otázky a čtyři koncepty by nikdy neviděla.
    const approved = first.items.map((item) => item.id)
    const put = await PUT(jsonReq('/api/questions', 'PUT', { ids: approved, status: 'approved' }))
    expect(put.status).toBe(200)

    // Pokračuje se kurzorem za první stránkou — tak, jak by to udělalo okno
    // ve frontě, kterému došly načtené otázky.
    const rest = await readAll(`/api/questions?status=draft&topicId=${topicId}`, 4, first.nextCursor)

    const zbytek = drafts.filter((id) => !approved.includes(id))
    expect(new Set(rest).size, 'některá otázka přišla dvakrát').toBe(rest.length)
    expect([...rest].sort()).toEqual([...zbytek].sort())
  })

  it('filtr podle tématu nepustí do fronty otázky odjinud', async () => {
    const mine = await seedTopic()
    const other = await seedTopic()
    const id = await seedQuestion(mine.topicId, { status: 'draft' })
    await seedQuestion(other.topicId, { status: 'draft' })

    const data = await page(`/api/questions?status=draft&topicId=${mine.topicId}`)
    expect(data.total).toBe(1)
    expect(data.items.map((item) => item.id)).toEqual([id])
  })

  it('zúžení na ročník i předmět projde přes patra knihovny', async () => {
    const mine = await seedTopic()
    const other = await seedTopic()
    await seedQuestion(mine.topicId, { status: 'draft' })
    await seedQuestion(other.topicId, { status: 'draft' })

    const podleRocniku = await page(`/api/questions?status=draft&gradeId=${mine.gradeId}`)
    expect(podleRocniku.total).toBe(1)

    const podlePredmetu = await page(`/api/questions?status=draft&subjectId=${mine.subjectId}`)
    expect(podlePredmetu.total).toBe(1)
  })
})

describe('hromadné schválení celého tématu', () => {
  it('změní jen koncepty daného tématu a vrátí jejich id pro vzetí zpět', async () => {
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
    const stav = new Map(rows.map((row) => [row.id, row.status]))
    expect(stav.get(draftA)).toBe('approved')
    expect(stav.get(draftB)).toBe('approved')
    // Co bylo schválené nebo zamítnuté už předtím, se akcí dotknout nesmí —
    // jinak by „Vzít zpět" vrátilo do konceptů i cizí práci.
    expect(stav.get(alreadyApproved)).toBe('approved')
    expect(stav.get(rejected)).toBe('rejected')
    expect(stav.get(foreignDraft)).toBe('draft')
  })

  it('téma bez konceptů nic nezmění a řekne to nulou', async () => {
    const { topicId } = await seedTopic()
    await seedQuestion(topicId, { status: 'approved' })
    const response = await PUT(
      jsonReq('/api/questions', 'PUT', { topicId, from: 'draft', status: 'approved' }),
    )
    await expect(response.json()).resolves.toMatchObject({ updated: 0, ids: [] })
  })
})
