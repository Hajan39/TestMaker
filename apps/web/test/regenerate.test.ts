import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import type { QuestionContent } from '@testmaker/core/schema'
import type { generateQuestions } from '@testmaker/core/ai'
import { db, generationJobs, questions } from '@/db'
import { TOPIC_BUSY_MESSAGE, regenerateQuestion } from '@/lib/generation'
import { newId } from '@/lib/ids'
import { seedMaterial, seedQuestion, seedTopic } from './helpers'

/** Materiál musí mít dost textu, jinak se generování odmítne ještě před modelem. */
const TEXT =
  'Koloběh vody v přírodě zahrnuje výpar, vznik oblaků, srážky a odtok vody zpět do moří a oceánů. '.repeat(
    6,
  )

const NAHRADA: QuestionContent = {
  type: 'single_choice',
  payload: { prompt: 'Čím je poháněn koloběh vody?', options: ['Sluncem', 'Větrem'], correctIndex: 0 },
  blocks: [],
  points: 1,
  difficulty: 2,
}

/** Podvržený poskytovatel: model, který vrátí přesně tuhle jednu otázku. */
const modelVrati: typeof generateQuestions = async () => ({
  questions: [NAHRADA],
  rejected: [],
  chunks: 1,
  failedCalls: [],
})

/** Podvržený poskytovatel, kterému se volání nepovede (vyčerpaná kvóta). */
const modelSelze: typeof generateQuestions = async () => {
  throw new Error('You exceeded your current quota, please check your plan')
}

/** Podvržený poskytovatel, který odpoví, ale nic použitelného nevrátí. */
const modelVratiNic: typeof generateQuestions = async () => ({
  questions: [],
  rejected: [{ index: 0, errors: ['nesmysl'] }],
  chunks: 1,
  failedCalls: [],
})

/** Stavy otázek jednoho tématu — soubor testů sdílí jednu databázi. */
async function stavy(topicId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: questions.id, status: questions.status })
    .from(questions)
    .where(eq(questions.topicId, topicId))
  return new Map(rows.map((row) => [row.id, row.status]))
}

describe('náhrada jedné otázky modelem', () => {
  it('nejdřív vznikne náhrada, teprve pak se původní zamítne', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })

    const replacement = await regenerateQuestion(original, { generate: modelVrati })

    expect(replacement.id).not.toBe(original)
    // Náhrada jde do fronty jako koncept — učitelka ji má vidět, než ji pustí do testu.
    expect(replacement.status).toBe('draft')
    expect(replacement.topicId).toBe(topicId)

    const stav = await stavy(topicId)
    expect(stav.get(original)).toBe('rejected')
    expect(stav.get(replacement.id)).toBe('draft')
  })

  it('když model selže, nezmění se v databázi vůbec nic', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })
    const pred = await stavy(topicId)

    await expect(regenerateQuestion(original, { generate: modelSelze })).rejects.toThrow(/quota/)

    const po = await stavy(topicId)
    expect(po).toEqual(pred)
    // Žádná nedopsaná otázka navíc: kdyby tu přibyla, seznam by byl delší.
    expect(po.size).toBe(1)
  })

  it('nepoužitelná odpověď modelu původní otázku nezamítne a vysvětlí se česky', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })

    await expect(regenerateQuestion(original, { generate: modelVratiNic })).rejects.toThrow(
      /Model nevrátil použitelnou náhradu/,
    )

    const po = await stavy(topicId)
    expect(po.get(original)).toBe('draft')
    expect(po.size).toBe(1)
  })

  it('nad tématem s běžícím dávkovým generováním se odmítne a téma nezablokuje', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })

    await db.insert(generationJobs).values({
      id: newId(),
      topicId,
      params: { count: 5, types: ['single_choice'], difficulty: 'mix' },
      status: 'running',
    })

    await expect(regenerateQuestion(original, { generate: modelVrati })).rejects.toThrow(TOPIC_BUSY_MESSAGE)

    // Rezervace zůstala jediná — náhrada si téma nezabrala pro sebe.
    const jobs = await db.select().from(generationJobs).where(eq(generationJobs.topicId, topicId))
    expect(jobs).toHaveLength(1)
    expect((await stavy(topicId)).get(original)).toBe('draft')
  })

  it('otázku bez tématu nahradit nejde — nemá se z čeho generovat', async () => {
    const orphan = await seedQuestion(null, { status: 'draft' })
    await expect(regenerateQuestion(orphan, { generate: modelVrati })).rejects.toThrow(/téma/)
  })
})
