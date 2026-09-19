import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { DELETE, GET, PATCH, POST, PUT } from '@/app/api/questions/route'
import { db, questions } from '@/db'
import { jsonReq, req, seedMaterial, seedQuestion, seedTopic } from './helpers'

/**
 * Banka otázek: hledání a filtry se vyřizují na serveru a stránkuje se
 * kurzorem. Dřív se do prohlížeče poslalo všech přes tisíc otázek i s obsahem
 * a hledalo se až tam.
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

/** Projde výsledek kurzorem až do konce a vrátí id v pořadí, v jakém přišla. */
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
  throw new Error('Stránkování nedojelo do konce')
}

describe('hledání v bance', () => {
  it('najde otázku podle slova ze zadání, i když je psané velkým písmenem', async () => {
    const { topicId } = await seedTopic()
    const hledana = await seedQuestion(topicId, { prompt: 'Čím dýchají ŽÁBRAMI ryby?' })
    await seedQuestion(topicId, { prompt: 'Kde roste kapradina?' })

    const data = await page(`/api/questions?q=${encodeURIComponent('žábrami')}`)
    expect(data.total).toBe(1)
    expect(data.items.map((item) => item.id)).toEqual([hledana])
  })

  it('procento v hledaném textu je znak, ne „cokoli“', async () => {
    const { topicId } = await seedTopic()
    const sProcentem = await seedQuestion(topicId, { prompt: 'Kolik je 100 % z celku?' })
    await seedQuestion(topicId, { prompt: 'Otázka bez procent' })

    // Bez odzávorkování by `%` v `like` znamenalo „cokoli“ a vrátilo by obě.
    const data = await page(`/api/questions?q=${encodeURIComponent('%')}`)
    expect(data.items.map((item) => item.id)).toEqual([sProcentem])
  })

  it('upravená otázka se najde podle nového znění, ne podle původního', async () => {
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
  it('se skládají dohromady — předmět, typ, stav i text naráz', async () => {
    const mine = await seedTopic()
    const other = await seedTopic()

    const hledana = await seedQuestion(mine.topicId, {
      prompt: 'Sopka a láva: co vytéká z kráteru?',
      status: 'draft',
      type: 'single_choice',
    })
    // Každá z následujících porušuje právě jednu podmínku filtru.
    await seedQuestion(mine.topicId, { prompt: 'Sopka a láva', status: 'approved', type: 'single_choice' })
    await seedQuestion(mine.topicId, { prompt: 'Sopka a láva', status: 'draft', type: 'open' })
    await seedQuestion(mine.topicId, { prompt: 'Něco úplně jiného', status: 'draft', type: 'single_choice' })
    await seedQuestion(other.topicId, { prompt: 'Sopka a láva', status: 'draft', type: 'single_choice' })

    const data = await page(
      `/api/questions?subjectId=${mine.subjectId}&status=draft&type=single_choice&q=${encodeURIComponent('sopka')}`,
    )
    expect(data.total).toBe(1)
    expect(data.items.map((item) => item.id)).toEqual([hledana])
  })

  it('zúžení na ročník a téma projde přes patra knihovny', async () => {
    const mine = await seedTopic()
    const other = await seedTopic()
    const id = await seedQuestion(mine.topicId, { prompt: 'Otázka v mém tématu' })
    await seedQuestion(other.topicId, { prompt: 'Otázka jinde' })

    await expect(page(`/api/questions?gradeId=${mine.gradeId}`)).resolves.toMatchObject({ total: 1 })
    const data = await page(`/api/questions?topicId=${mine.topicId}`)
    expect(data.items.map((item) => item.id)).toEqual([id])
  })
})

describe('stránkování banky', () => {
  it('kurzor nevynechá ani nezopakuje otázku a drží se filtru', async () => {
    const { topicId, subjectId } = await seedTopic()
    const chtene: string[] = []
    for (let i = 0; i < 17; i += 1) {
      const id = await seedQuestion(topicId, { prompt: `Koloběh vody ${i}`, status: 'draft' })
      chtene.push(id)
    }
    // Otázky, které filtru neodpovídají — do stránkování se nesmějí připlést.
    for (let i = 0; i < 5; i += 1) {
      await seedQuestion(topicId, { prompt: `Něco jiného ${i}`, status: 'approved' })
    }

    const url = `/api/questions?subjectId=${subjectId}&status=draft&q=${encodeURIComponent('koloběh')}`
    const first = await page(`${url}&limit=5`)
    expect(first.total).toBe(17)
    expect(first.items).toHaveLength(5)

    const seen = await readAll(url, 5)
    expect(new Set(seen).size, 'některá otázka přišla dvakrát').toBe(seen.length)
    expect([...seen].sort()).toEqual([...chtene].sort())
  })

  it('poslední stránka už další kurzor nenabídne', async () => {
    const { topicId } = await seedTopic()
    for (let i = 0; i < 3; i += 1) await seedQuestion(topicId, { prompt: `Kratičká ${i}` })

    const data = await page(`/api/questions?topicId=${topicId}&limit=5`)
    expect(data.items).toHaveLength(3)
    expect(data.nextCursor).toBeNull()
  })
})

describe('hromadné akce v bance', () => {
  it('schválí vybrané otázky napříč předměty a ostatních se nedotkne', async () => {
    const mine = await seedTopic()
    const other = await seedTopic()
    const prvni = await seedQuestion(mine.topicId, { status: 'draft' })
    const druha = await seedQuestion(other.topicId, { status: 'draft' })
    const nedotcena = await seedQuestion(mine.topicId, { status: 'draft' })

    const response = await PUT(
      jsonReq('/api/questions', 'PUT', { ids: [prvni, druha], status: 'approved' }),
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ updated: 2 })

    const stav = new Map(
      (await db.select({ id: questions.id, status: questions.status }).from(questions)).map((row) => [
        row.id,
        row.status,
      ]),
    )
    expect(stav.get(prvni)).toBe('approved')
    expect(stav.get(druha)).toBe('approved')
    expect(stav.get(nedotcena)).toBe('draft')
  })

  it('zamítnutí se dá vrátit zpět po skupinách podle původních stavů', async () => {
    const { topicId } = await seedTopic()
    const koncept = await seedQuestion(topicId, { status: 'draft' })
    const schvalena = await seedQuestion(topicId, { status: 'approved' })

    await PUT(jsonReq('/api/questions', 'PUT', { ids: [koncept, schvalena], status: 'rejected' }))
    // Přesně to, co po kliknutí na „Vzít zpět“ pošle rozhraní: každou skupinu
    // zvlášť do jejího původního stavu.
    await PUT(jsonReq('/api/questions', 'PUT', { ids: [koncept], status: 'draft' }))
    await PUT(jsonReq('/api/questions', 'PUT', { ids: [schvalena], status: 'approved' }))

    const [a] = await db.select({ status: questions.status }).from(questions).where(eq(questions.id, koncept))
    const [b] = await db
      .select({ status: questions.status })
      .from(questions)
      .where(eq(questions.id, schvalena))
    expect(a?.status).toBe('draft')
    expect(b?.status).toBe('approved')
  })

  it('smaže vybrané otázky a zbytek banky nechá být', async () => {
    const { topicId } = await seedTopic()
    const smazana = await seedQuestion(topicId, { prompt: 'Tahle jde pryč' })
    const zustava = await seedQuestion(topicId, { prompt: 'Tahle zůstává' })

    const response = await DELETE(req(`/api/questions?id=${encodeURIComponent(smazana)}`))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ deleted: 1 })

    const zbyle = new Set((await db.select({ id: questions.id }).from(questions)).map((row) => row.id))
    expect(zbyle.has(smazana)).toBe(false)
    expect(zbyle.has(zustava)).toBe(true)
  })
})

describe('původ otázky', () => {
  /** Založí otázku s dokladem původu a vrátí její řádek z databáze. */
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

  it('podle názvu souboru v dokladu se dohledá materiál, ze kterého otázka vznikla', async () => {
    const { topicId } = await seedTopic()
    const materialId = await seedMaterial(topicId, { fileName: 'Savci.pdf' })

    expect((await createWithEvidence(topicId, 'Savci.pdf'))?.materialId).toBe(materialId)
  })

  it('název, který v tématu není, vazbu nevymyslí', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'Savci.pdf' })

    expect((await createWithEvidence(topicId, 'Ptáci.pdf'))?.materialId).toBeNull()
  })

  it('u dvou materiálů téhož jména zůstane vazba prázdná, místo aby se hádalo', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'Savci.pdf' })
    await seedMaterial(topicId, { fileName: 'Savci.pdf' })

    expect((await createWithEvidence(topicId, 'Savci.pdf'))?.materialId).toBeNull()
  })
})
