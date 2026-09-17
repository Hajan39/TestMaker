import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db, generationJobs, type GenerationJobParams } from '@/db'
import { claimTopic, isTopicBusy, releaseTopic } from '@/lib/generation'
import { newId } from '@/lib/ids'
import { seedTopic } from './helpers'

/**
 * Rezervace tématu pro generování. Dvě generování nad týmž tématem naráz by
 * pracovala se stejným seznamem „těmhle otázkám se vyhni" a vyrobila duplicity,
 * takže tématu smí patřit vždycky jen jedna rezervace.
 */

async function jobsOf(topicId: string) {
  return db.select().from(generationJobs).where(eq(generationJobs.topicId, topicId))
}

describe('rezervace tématu', () => {
  it('první zabrání projde a založí běžící úlohu', async () => {
    const { topicId } = await seedTopic()

    const jobId = await claimTopic(topicId)

    expect(jobId).toBeTruthy()
    const [job] = await jobsOf(topicId)
    expect(job).toMatchObject({ id: jobId, status: 'running' })
    expect(job?.startedAt).toBeTruthy()
    expect(await isTopicBusy(topicId)).toBe(true)
  })

  it('druhé zabrání téhož tématu neprojde a nic po sobě nenechá', async () => {
    const { topicId } = await seedTopic()
    await claimTopic(topicId)

    expect(await claimTopic(topicId)).toBeNull()
    expect(await jobsOf(topicId)).toHaveLength(1)
  })

  it('téma čekající ve frontě se taky nedá zabrat', async () => {
    const { topicId } = await seedTopic()
    await db
      .insert(generationJobs)
      .values({ id: newId(), topicId, params: {} as GenerationJobParams, status: 'queued' })

    expect(await claimTopic(topicId)).toBeNull()
  })

  it('po uvolnění jde téma zabrat znovu', async () => {
    const { topicId } = await seedTopic()
    const jobId = await claimTopic(topicId)
    await releaseTopic(jobId!, { created: 3 })

    expect(await isTopicBusy(topicId)).toBe(false)
    expect(await claimTopic(topicId)).toBeTruthy()
  })

  it('hotová ani chybná úloha další generování neblokuje', async () => {
    const { topicId } = await seedTopic()
    await db.insert(generationJobs).values([
      { id: newId(), topicId, params: {} as GenerationJobParams, status: 'done' },
      { id: newId(), topicId, params: {} as GenerationJobParams, status: 'error' },
    ])

    expect(await claimTopic(topicId)).toBeTruthy()
  })

  it('souběžná zabrání téhož tématu vyhraje právě jedno', async () => {
    const { topicId } = await seedTopic()

    // Rezervace je jeden příkaz `insert … where not exists`, takže ani takhle
    // se nemůže stát, že si téma zaberou dva běhy naráz.
    const vysledky = await Promise.all(Array.from({ length: 5 }, () => claimTopic(topicId)))

    expect(vysledky.filter(Boolean)).toHaveLength(1)
    expect(await jobsOf(topicId)).toHaveLength(1)
  })

  it('různá témata se navzájem neblokují', async () => {
    const prvni = await seedTopic()
    const druhe = await seedTopic()

    expect(await claimTopic(prvni.topicId)).toBeTruthy()
    expect(await claimTopic(druhe.topicId)).toBeTruthy()
  })
})
