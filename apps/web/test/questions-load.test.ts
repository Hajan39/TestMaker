import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { AI_SETTINGS } from '@testmaker/core/ai'
import { db, questions } from '@/db'
import { QUESTION_LIST_LIMIT, loadAvoidPrompts, loadQuestions } from '@/lib/questions'
import { seedQuestion, seedTopic, UCET } from './helpers'

/**
 * Načítání otázek pro obrazovku tématu a pro seznam „těmhle se vyhni".
 * Obojí má strop; podstatné je, aby se o to, co se ořízne, nepřišlo mlčky.
 */

/** Otázky s daným pořadím vzniku — čas se musí lišit, jinak řadí až id. */
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

describe('seznam otázek tématu', () => {
  it('kratší seznam než limit se nehlásí jako useknutý', async () => {
    const { topicId } = await seedTopic()
    await seedSequence(topicId, ['První', 'Druhá'])

    const list = await loadQuestions(UCET, { topicIds: [topicId] })
    expect(list.items).toHaveLength(2)
    expect(list.truncated).toBe(false)
    expect(list.limit).toBe(QUESTION_LIST_LIMIT)
  })

  it('delší seznam se ořízne a volající se to doví', async () => {
    const { topicId } = await seedTopic()
    await seedSequence(topicId, ['První', 'Druhá', 'Třetí'])

    const list = await loadQuestions(UCET, { topicIds: [topicId], limit: 2 })
    expect(list.items).toHaveLength(2)
    expect(list.truncated).toBe(true)
    expect(list.limit).toBe(2)
  })

  it('řadí od nejnovější — co vzniklo naposled, je nahoře', async () => {
    const { topicId } = await seedTopic()
    await seedSequence(topicId, ['Nejstarší', 'Prostřední', 'Nejnovější'])

    const list = await loadQuestions(UCET, { topicIds: [topicId] })
    expect(list.items.map((item) => (item.payload as { prompt: string }).prompt)).toEqual([
      'Nejnovější',
      'Prostřední',
      'Nejstarší',
    ])
  })

  it('přesně na limit useknutý není', async () => {
    const { topicId } = await seedTopic()
    await seedSequence(topicId, ['První', 'Druhá'])

    const list = await loadQuestions(UCET, { topicIds: [topicId], limit: 2 })
    expect(list.truncated).toBe(false)
  })
})

describe('seznam „těmhle otázkám se vyhni"', () => {
  it('bere nejnovější otázky, ne náhodné', async () => {
    const { topicId } = await seedTopic()
    await seedSequence(topicId, ['Nejstarší', 'Prostřední', 'Nejnovější'])

    const avoid = await loadAvoidPrompts(UCET, topicId, 2)
    expect(avoid).toEqual(['Nejnovější', 'Prostřední'])
  })

  it('výchozí strop odpovídá tomu, kolik se jich vejde do promptu', async () => {
    const { topicId } = await seedTopic()
    await seedSequence(
      topicId,
      Array.from({ length: 5 }, (_, index) => `Otázka ${index}`),
    )

    const avoid = await loadAvoidPrompts(UCET, topicId)
    // Prompt seznam ořezává na `AI_SETTINGS.avoidLimit`; načítat víc nemá smysl,
    // protože o zahozených položkách by rozhodovalo pořadí řádků v databázi.
    expect(avoid.length).toBeLessThanOrEqual(AI_SETTINGS.avoidLimit)
    expect(avoid).toHaveLength(5)
  })

  it('otázky jiného tématu do seznamu nepatří', async () => {
    const { topicId } = await seedTopic()
    const jine = await seedTopic()
    await seedSequence(topicId, ['Naše'])
    await seedSequence(jine.topicId, ['Cizí'])

    expect(await loadAvoidPrompts(UCET, topicId)).toEqual(['Naše'])
  })
})
