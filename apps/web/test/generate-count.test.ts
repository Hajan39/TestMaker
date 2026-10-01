import { describe, expect, it } from 'vitest'
import { DEFAULT_GENERATE_PARAMS, resolveCount } from '@/lib/generation'
import { seedQuestion, seedTopic, ACCOUNT } from './helpers'

/**
 * How many questions a run creates. After reviewing drafts the teacher rejects
 * some and needs to restore the count, not start from zero — that's what the
 * "top up to this count" mode is for.
 */
describe('question count in one run', () => {
  it('without topping up exactly the requested count is created', async () => {
    const { topicId } = await seedTopic()
    await seedQuestion(topicId)

    const count = await resolveCount(ACCOUNT, topicId, { ...DEFAULT_GENERATE_PARAMS, count: 8 })
    expect(count).toBe(8)
  })

  it('topping up subtracts the questions remaining in the topic', async () => {
    const { topicId } = await seedTopic()
    await seedQuestion(topicId, { status: 'approved' })
    await seedQuestion(topicId, { status: 'draft' })

    const count = await resolveCount(ACCOUNT, topicId, { ...DEFAULT_GENERATE_PARAMS, count: 10, mode: 'target' })
    expect(count).toBe(8)
  })

  it('rejected questions do not count', async () => {
    const { topicId } = await seedTopic()
    await seedQuestion(topicId, { status: 'approved' })
    await seedQuestion(topicId, { status: 'rejected' })
    await seedQuestion(topicId, { status: 'rejected' })

    const count = await resolveCount(ACCOUNT, topicId, { ...DEFAULT_GENERATE_PARAMS, count: 5, mode: 'target' })
    expect(count).toBe(4)
  })

  it('a full topic creates nothing', async () => {
    const { topicId } = await seedTopic()
    await seedQuestion(topicId)
    await seedQuestion(topicId)

    const count = await resolveCount(ACCOUNT, topicId, { ...DEFAULT_GENERATE_PARAMS, count: 2, mode: 'target' })
    expect(count).toBe(0)
  })

  it('an empty topic gets the whole requested count', async () => {
    const { topicId } = await seedTopic()

    const count = await resolveCount(ACCOUNT, topicId, { ...DEFAULT_GENERATE_PARAMS, count: 12, mode: 'target' })
    expect(count).toBe(12)
  })
})
