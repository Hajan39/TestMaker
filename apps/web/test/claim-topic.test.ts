import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db, generationJobs, type GenerationJobParams } from '@/db'
import { claimTopic, isTopicBusy, releaseTopic } from '@/lib/generation'
import { newId } from '@/lib/ids'
import { seedTopic, ACCOUNT } from './helpers'

/**
 * Claiming a topic for generation. Two generations over the same topic at once
 * would work with the same "avoid these questions" list and produce duplicates,
 * so a topic may only ever have one claim.
 */

async function jobsOf(topicId: string) {
  return db.select().from(generationJobs).where(eq(generationJobs.topicId, topicId))
}

describe('topic claim', () => {
  it('the first claim succeeds and creates a running job', async () => {
    const { topicId } = await seedTopic()

    const jobId = await claimTopic(ACCOUNT, topicId)

    expect(jobId).toBeTruthy()
    const [job] = await jobsOf(topicId)
    expect(job).toMatchObject({ id: jobId, status: 'running' })
    expect(job?.startedAt).toBeTruthy()
    expect(await isTopicBusy(ACCOUNT, topicId)).toMatchObject({ who: expect.any(String) })
  })

  it('a second claim of the same topic fails and leaves nothing behind', async () => {
    const { topicId } = await seedTopic()
    await claimTopic(ACCOUNT, topicId)

    expect(await claimTopic(ACCOUNT, topicId)).toBeNull()
    expect(await jobsOf(topicId)).toHaveLength(1)
  })

  it('a topic waiting in the queue cannot be claimed either', async () => {
    const { topicId } = await seedTopic()
    await db
      .insert(generationJobs)
      .values({ id: newId(), schoolId: ACCOUNT.schoolId, requestedBy: ACCOUNT.userId, topicId, params: {} as GenerationJobParams, status: 'queued' })

    expect(await claimTopic(ACCOUNT, topicId)).toBeNull()
  })

  it('after release the topic can be claimed again', async () => {
    const { topicId } = await seedTopic()
    const jobId = await claimTopic(ACCOUNT, topicId)
    await releaseTopic(jobId!, { created: 3 })

    expect(await isTopicBusy(ACCOUNT, topicId)).toBeNull()
    expect(await claimTopic(ACCOUNT, topicId)).toBeTruthy()
  })

  it('neither a finished nor a failed job blocks further generation', async () => {
    const { topicId } = await seedTopic()
    await db.insert(generationJobs).values([
      { id: newId(), schoolId: ACCOUNT.schoolId, requestedBy: ACCOUNT.userId, topicId, params: {} as GenerationJobParams, status: 'done' },
      { id: newId(), schoolId: ACCOUNT.schoolId, requestedBy: ACCOUNT.userId, topicId, params: {} as GenerationJobParams, status: 'error' },
    ])

    expect(await claimTopic(ACCOUNT, topicId)).toBeTruthy()
  })

  it('of concurrent claims of the same topic exactly one wins', async () => {
    const { topicId } = await seedTopic()

    // The claim is a single `insert … where not exists` statement, so even
    // like this two runs can never claim the topic at once.
    const results = await Promise.all(Array.from({ length: 5 }, () => claimTopic(ACCOUNT, topicId)))

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await jobsOf(topicId)).toHaveLength(1)
  })

  it('different topics do not block each other', async () => {
    const first = await seedTopic()
    const second = await seedTopic()

    expect(await claimTopic(ACCOUNT, first.topicId)).toBeTruthy()
    expect(await claimTopic(ACCOUNT, second.topicId)).toBeTruthy()
  })
})
