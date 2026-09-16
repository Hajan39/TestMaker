import { describe, expect, it } from 'vitest'
import { DEFAULT_GENERATE_PARAMS, resolveCount } from '@/lib/generation'
import { seedQuestion, seedTopic } from './helpers'

/**
 * Kolik otázek se v běhu vytvoří. Učitelka po kontrole konceptů část zamítne
 * a potřebuje dorovnat počet, ne začínat od nuly — od toho je režim
 * „doplnit na tenhle počet".
 */
describe('počet otázek v jednom běhu', () => {
  it('bez doplňování se vytvoří přesně zadaný počet', async () => {
    const { topicId } = await seedTopic()
    await seedQuestion(topicId)

    const count = await resolveCount(topicId, { ...DEFAULT_GENERATE_PARAMS, count: 8 })
    expect(count).toBe(8)
  })

  it('doplňování odečte otázky, které v tématu zůstaly', async () => {
    const { topicId } = await seedTopic()
    await seedQuestion(topicId, { status: 'approved' })
    await seedQuestion(topicId, { status: 'draft' })

    const count = await resolveCount(topicId, { ...DEFAULT_GENERATE_PARAMS, count: 10, mode: 'target' })
    expect(count).toBe(8)
  })

  it('zamítnuté otázky se do počtu nepočítají', async () => {
    const { topicId } = await seedTopic()
    await seedQuestion(topicId, { status: 'approved' })
    await seedQuestion(topicId, { status: 'rejected' })
    await seedQuestion(topicId, { status: 'rejected' })

    const count = await resolveCount(topicId, { ...DEFAULT_GENERATE_PARAMS, count: 5, mode: 'target' })
    expect(count).toBe(4)
  })

  it('naplněné téma nevytvoří nic', async () => {
    const { topicId } = await seedTopic()
    await seedQuestion(topicId)
    await seedQuestion(topicId)

    const count = await resolveCount(topicId, { ...DEFAULT_GENERATE_PARAMS, count: 2, mode: 'target' })
    expect(count).toBe(0)
  })

  it('prázdné téma doplní celý zadaný počet', async () => {
    const { topicId } = await seedTopic()

    const count = await resolveCount(topicId, { ...DEFAULT_GENERATE_PARAMS, count: 12, mode: 'target' })
    expect(count).toBe(12)
  })
})
