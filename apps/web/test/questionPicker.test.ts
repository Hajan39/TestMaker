import { describe, expect, it } from 'vitest'
import { loadPickerTopics } from '@/lib/questionPicker'
import { seedQuestion, seedTopic, ACCOUNT } from './helpers'

/**
 * Only an approved question may go into a test. Until the status was read, a
 * question the teacher rejected could be picked into a test too — approval
 * then had no effect and reviewing was work for nothing.
 */
describe('picking questions for a test', () => {
  it('returns neither a draft nor a rejected question', async () => {
    const { topicId } = await seedTopic({ topic: 'Dýchací soustava' })
    const approved = await seedQuestion(topicId, { prompt: 'Schválená', status: 'approved' })
    await seedQuestion(topicId, { prompt: 'Koncept', status: 'draft' })
    await seedQuestion(topicId, { prompt: 'Zamítnutá', status: 'rejected' })

    const topics = await loadPickerTopics(ACCOUNT)
    const picked = topics.flatMap((topic) => topic.questions)

    expect(picked.map((question) => question.id)).toEqual([approved])
    expect(picked.every((question) => question.status === 'approved')).toBe(true)
  })

  it('carries the grade id, not just its name — the bank pre-filters to the test class by it', async () => {
    const { topicId, gradeId } = await seedTopic({ topic: 'Oběhová soustava' })
    await seedQuestion(topicId, { prompt: 'Schválená', status: 'approved' })

    const topics = await loadPickerTopics(ACCOUNT)
    const topic = topics.find((entry) => entry.id === topicId)

    expect(topic?.gradeId).toBe(gradeId)
  })

  it('a topic with only drafts is not offered at all', async () => {
    const { topicId } = await seedTopic({ topic: 'Jen koncepty' })
    await seedQuestion(topicId, { status: 'draft' })

    const topics = await loadPickerTopics(ACCOUNT)
    expect(topics.find((topic) => topic.id === topicId)).toBeUndefined()
  })

  it('the bank overview asks for drafts and rejected ones too', async () => {
    const { topicId } = await seedTopic({ topic: 'Přehled banky' })
    await seedQuestion(topicId, { status: 'approved' })
    await seedQuestion(topicId, { status: 'draft' })
    await seedQuestion(topicId, { status: 'rejected' })

    const topics = await loadPickerTopics(ACCOUNT, { statuses: ['draft', 'approved', 'rejected'] })
    const topic = topics.find((entry) => entry.id === topicId)
    expect(topic?.questions).toHaveLength(3)
  })
})
