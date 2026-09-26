import { beforeAll, describe, expect, it } from 'vitest'
import { db, testItems, tests } from '@/db'
import { newId } from '@/lib/ids'
import { loadTestUsageForQuestions } from '@/lib/tests'
import { seedQuestion, seedTemplate, seedTopic, seedUcet, UCET } from './helpers'

/**
 * Které testy má otázka v sobě — jen ty, na které volající skutečně vidí
 * (`viditelnyTest`). Cizí soukromý test kolegyně otázku prozradit nesmí, i
 * kdyby ji obsahoval — to je bod revize 1 v plánu.
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
  it('prázdný vstup vrátí prázdný objekt bez dotazu', async () => {
    const usage = await loadTestUsageForQuestions(UCET, [])
    expect(usage).toEqual({})
  })

  it('otázka ve vlastním testu je vrácena', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Vlastní otázka' })
    const testId = newId()
    await db.insert(tests).values({
      id: testId,
      schoolId: UCET.schoolId,
      ownerId: UCET.userId,
      visibility: 'soukrome',
      title: 'Můj test',
      templateId,
      header: emptyHeader,
    })
    await db.insert(testItems).values({
      id: newId(),
      schoolId: UCET.schoolId,
      testId,
      position: 0,
      kind: 'question',
      questionId,
    })

    const usage = await loadTestUsageForQuestions(UCET, [questionId])
    expect(usage[questionId]).toEqual([{ testId, title: 'Můj test' }])
  })

  it('otázka v soukromém testu kolegyně není vrácena', async () => {
    const kolegyne = await seedUcet()
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka v cizím testu' })
    const testId = newId()
    await db.insert(tests).values({
      id: testId,
      schoolId: UCET.schoolId,
      ownerId: kolegyne.userId,
      visibility: 'soukrome',
      title: 'Test kolegyně',
      templateId,
      header: emptyHeader,
    })
    await db.insert(testItems).values({
      id: newId(),
      schoolId: UCET.schoolId,
      testId,
      position: 0,
      kind: 'question',
      questionId,
    })

    const usage = await loadTestUsageForQuestions(UCET, [questionId])
    expect(usage[questionId] ?? []).toEqual([])
  })

  it('otázka v testu kolegyně nasdíleném škole je vrácena', async () => {
    const kolegyne = await seedUcet()
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka v nasdíleném testu' })
    const testId = newId()
    await db.insert(tests).values({
      id: testId,
      schoolId: UCET.schoolId,
      ownerId: kolegyne.userId,
      visibility: 'skola',
      title: 'Nasdílený test',
      templateId,
      header: emptyHeader,
    })
    await db.insert(testItems).values({
      id: newId(),
      schoolId: UCET.schoolId,
      testId,
      position: 0,
      kind: 'question',
      questionId,
    })

    const usage = await loadTestUsageForQuestions(UCET, [questionId])
    expect(usage[questionId]).toEqual([{ testId, title: 'Nasdílený test' }])
  })

  it('tentýž test dvakrát u jedné otázky se vrátí jen jednou', async () => {
    const questionId = await seedQuestion(topicId, { prompt: 'Otázka dvakrát v testu' })
    const testId = newId()
    await db.insert(tests).values({
      id: testId,
      schoolId: UCET.schoolId,
      ownerId: UCET.userId,
      visibility: 'soukrome',
      title: 'Test s dvojím výskytem',
      templateId,
      header: emptyHeader,
    })
    await db.insert(testItems).values([
      { id: newId(), schoolId: UCET.schoolId, testId, position: 0, kind: 'question', questionId },
      { id: newId(), schoolId: UCET.schoolId, testId, position: 1, kind: 'question', questionId },
    ])

    const usage = await loadTestUsageForQuestions(UCET, [questionId])
    expect(usage[questionId]).toEqual([{ testId, title: 'Test s dvojím výskytem' }])
  })
})
