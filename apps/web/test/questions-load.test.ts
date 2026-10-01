import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { AI_SETTINGS } from '@testmaker/core/ai'
import { db, questions } from '@/db'
import { QUESTION_LIST_LIMIT, loadAvoidPrompts, loadQuestions } from '@/lib/questions'
import { seedQuestion, seedTopic, ACCOUNT } from './helpers'

/**
 * Loading questions for the topic screen and for the "avoid these" list.
 * Both have a cap; what matters is that nothing trimmed is lost silently.
 */

/** Questions with a given creation order — times must differ, otherwise id decides. */
async function seedSequence(topicId: string, prompts: string[]): Promise<string[]> {
  const ids: string[] = []
  for (const [index, prompt] of prompts.entries()) {
    const id = await seedQuestion(topicId, { prompt })
    await db
      .update(questions)
      .set({ createdAt: `2026-01-${String(index + 1).padStart(2, '0')}T10:00:00.000Z` })
      .where(eq(questions.id, id))
    ids.push(id)
  }
  return ids
}

describe("a topic's question list", () => {
  it('a list shorter than the limit is not reported as truncated', async () => {
    const { topicId } = await seedTopic()
    await seedSequence(topicId, ['První', 'Druhá'])

    const list = await loadQuestions(ACCOUNT, { topicIds: [topicId] })
    expect(list.items).toHaveLength(2)
    expect(list.truncated).toBe(false)
    expect(list.limit).toBe(QUESTION_LIST_LIMIT)
  })

  it('a longer list is trimmed and the caller learns about it', async () => {
    const { topicId } = await seedTopic()
    await seedSequence(topicId, ['První', 'Druhá', 'Třetí'])

    const list = await loadQuestions(ACCOUNT, { topicIds: [topicId], limit: 2 })
    expect(list.items).toHaveLength(2)
    expect(list.truncated).toBe(true)
    expect(list.limit).toBe(2)
  })

  it('sorts newest first — what was created last is on top', async () => {
    const { topicId } = await seedTopic()
    await seedSequence(topicId, ['Nejstarší', 'Prostřední', 'Nejnovější'])

    const list = await loadQuestions(ACCOUNT, { topicIds: [topicId] })
    expect(list.items.map((item) => (item.payload as { prompt: string }).prompt)).toEqual([
      'Nejnovější',
      'Prostřední',
      'Nejstarší',
    ])
  })

  it('exactly at the limit is not truncated', async () => {
    const { topicId } = await seedTopic()
    await seedSequence(topicId, ['První', 'Druhá'])

    const list = await loadQuestions(ACCOUNT, { topicIds: [topicId], limit: 2 })
    expect(list.truncated).toBe(false)
  })
})

describe('the "avoid these questions" list', () => {
  it('takes the newest questions, not random ones', async () => {
    const { topicId } = await seedTopic()
    await seedSequence(topicId, ['Nejstarší', 'Prostřední', 'Nejnovější'])

    const avoid = await loadAvoidPrompts(ACCOUNT, topicId, 2)
    expect(avoid).toEqual(['Nejnovější', 'Prostřední'])
  })

  it('the default cap matches how many fit into the prompt', async () => {
    const { topicId } = await seedTopic()
    await seedSequence(
      topicId,
      Array.from({ length: 5 }, (_, index) => `Otázka ${index}`),
    )

    const avoid = await loadAvoidPrompts(ACCOUNT, topicId)
    // The prompt trims the list to `AI_SETTINGS.avoidLimit`; loading more makes
    // no sense, since database row order would decide the dropped items.
    expect(avoid.length).toBeLessThanOrEqual(AI_SETTINGS.avoidLimit)
    expect(avoid).toHaveLength(5)
  })

  it("another topic's questions don't belong in the list", async () => {
    const { topicId } = await seedTopic()
    const other = await seedTopic()
    await seedSequence(topicId, ['Naše'])
    await seedSequence(other.topicId, ['Cizí'])

    expect(await loadAvoidPrompts(ACCOUNT, topicId)).toEqual(['Naše'])
  })
})
