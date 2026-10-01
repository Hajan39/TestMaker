import { beforeAll, describe, expect, it } from 'vitest'
import { db, testItems, tests } from '@/db'
import { newId } from '@/lib/ids'
import { loadTestUsageForQuestions } from '@/lib/tests'
import { seedQuestion, seedTemplate, seedTopic, seedAccount, ACCOUNT } from './helpers'

/**
 * Which tests contain a question — only those the caller can actually see
 * (`visibleTest`). A colleague's private test must not reveal the question,
 * even if it contains it — that is review point 1 in the plan.
 */

let templateId: string
let topicId: string

const emptyHeader = { school: '', subject: '', className: '', teacher: '', date: '', note: '' }

beforeAll(async () => {
  templateId = await seedTemplate()
  const topic = await seedTopic()
  topicId = topic.topicId
})

describe('loadTestUsageForQuestions', () => {
  it('returns an empty object for empty input without querying', async () => {
    const usage = await loadTestUsageForQuestions(ACCOUNT, [])
    expect(usage).toEqual({})
  })

  it('returns a question in an own test', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Vlastní otázka' })
    const testId = newId()
    await db.insert(tests).values({
      id: testId,
      schoolId: ACCOUNT.schoolId,
      ownerId: ACCOUNT.userId,
      visibility: 'soukrome',
      title: 'Můj test',
      templateId,
      header: emptyHeader,
    })
    await db.insert(testItems).values({
      id: newId(),
      schoolId: ACCOUNT.schoolId,
      testId,
      position: 0,
      kind: 'question',
      questionId,
    })

    const usage = await loadTestUsageForQuestions(ACCOUNT, [questionId])
    expect(usage[questionId]).toEqual([{ testId, title: 'Můj test' }])
  })

  it('does not return a question in a colleague\'s private test', async () => {
    const colleague = await seedAccount()
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka v cizím testu' })
    const testId = newId()
    await db.insert(tests).values({
      id: testId,
      schoolId: ACCOUNT.schoolId,
      ownerId: colleague.userId,
      visibility: 'soukrome',
      title: 'Test kolegyně',
      templateId,
      header: emptyHeader,
    })
    await db.insert(testItems).values({
      id: newId(),
      schoolId: ACCOUNT.schoolId,
      testId,
      position: 0,
      kind: 'question',
      questionId,
    })

    const usage = await loadTestUsageForQuestions(ACCOUNT, [questionId])
    expect(usage[questionId] ?? []).toEqual([])
  })

  it('returns a question in a colleague\'s test shared with the school', async () => {
    const colleague = await seedAccount()
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka v nasdíleném testu' })
    const testId = newId()
    await db.insert(tests).values({
      id: testId,
      schoolId: ACCOUNT.schoolId,
      ownerId: colleague.userId,
      visibility: 'skola',
      title: 'Nasdílený test',
      templateId,
      header: emptyHeader,
    })
    await db.insert(testItems).values({
      id: newId(),
      schoolId: ACCOUNT.schoolId,
      testId,
      position: 0,
      kind: 'question',
      questionId,
    })

    const usage = await loadTestUsageForQuestions(ACCOUNT, [questionId])
    expect(usage[questionId]).toEqual([{ testId, title: 'Nasdílený test' }])
  })

  it('returns the same test only once for one question', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka dvakrát v testu' })
    const testId = newId()
    await db.insert(tests).values({
      id: testId,
      schoolId: ACCOUNT.schoolId,
      ownerId: ACCOUNT.userId,
      visibility: 'soukrome',
      title: 'Test s dvojím výskytem',
      templateId,
      header: emptyHeader,
    })
    await db.insert(testItems).values([
      { id: newId(), schoolId: ACCOUNT.schoolId, testId, position: 0, kind: 'question', questionId },
      { id: newId(), schoolId: ACCOUNT.schoolId, testId, position: 1, kind: 'question', questionId },
    ])

    const usage = await loadTestUsageForQuestions(ACCOUNT, [questionId])
    expect(usage[questionId]).toEqual([{ testId, title: 'Test s dvojím výskytem' }])
  })
})
