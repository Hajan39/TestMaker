import { describe, expect, it } from 'vitest'
import { loadPickerTopics } from '@/lib/questionPicker'
import { seedQuestion, seedTopic } from './helpers'

/**
 * Do písemky smí jen schválená otázka. Dokud se stav nečetl, šlo do testu
 * vybrat i otázku, kterou učitelka zamítla — schvalování pak nemělo žádný
 * účinek a kontrola byla práce pro nic.
 */
describe('výběr otázek do testu', () => {
  it('nevydá koncept ani zamítnutou otázku', async () => {
    const { topicId } = await seedTopic({ topic: 'Dýchací soustava' })
    const approved = await seedQuestion(topicId, { prompt: 'Schválená', status: 'approved' })
    await seedQuestion(topicId, { prompt: 'Koncept', status: 'draft' })
    await seedQuestion(topicId, { prompt: 'Zamítnutá', status: 'rejected' })

    const topics = await loadPickerTopics()
    const picked = topics.flatMap((topic) => topic.questions)

    expect(picked.map((question) => question.id)).toEqual([approved])
    expect(picked.every((question) => question.status === 'approved')).toBe(true)
  })

  it('téma, ve kterém jsou jen koncepty, v nabídce vůbec není', async () => {
    const { topicId } = await seedTopic({ topic: 'Jen koncepty' })
    await seedQuestion(topicId, { status: 'draft' })

    const topics = await loadPickerTopics()
    expect(topics.find((topic) => topic.id === topicId)).toBeUndefined()
  })

  it('přehled banky si vyžádá i koncepty a zamítnuté', async () => {
    const { topicId } = await seedTopic({ topic: 'Přehled banky' })
    await seedQuestion(topicId, { status: 'approved' })
    await seedQuestion(topicId, { status: 'draft' })
    await seedQuestion(topicId, { status: 'rejected' })

    const topics = await loadPickerTopics({ statuses: ['draft', 'approved', 'rejected'] })
    const topic = topics.find((entry) => entry.id === topicId)
    expect(topic?.questions).toHaveLength(3)
  })
})
