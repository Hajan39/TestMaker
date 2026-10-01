import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { QuestionFileError, schoolRulesFromSource } from '@testmaker/core/ai'
import { db, promptRules, questions } from '@/db'
import { importQuestionFile, topicSourceFile } from '@/lib/questionFile'
import { newId } from '@/lib/ids'
import { seedMaterial, seedTopic, ACCOUNT } from './helpers'

const TEXT = 'Houby nemají chlorofyl, a proto si potravu nevyrábějí samy. '.repeat(8)

beforeEach(async () => {
  await db.delete(promptRules)
})

describe('questions from Claude Code', () => {
  it('downloads the topic text with a header and imports back only valid questions', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })

    const source = await topicSourceFile(ACCOUNT, topicId)
    expect(source?.text).toContain('=== houby.pdf ===')
    expect(source?.text).toMatch(/^# Předmět: /)

    const result = await importQuestionFile(
      ACCOUNT,
      topicId,
      JSON.stringify({
        questions: [
          {
            type: 'short_answer',
            payload: { prompt: 'Co houbám chybí?', answer: 'chlorofyl' },
            evidence: { fileName: 'houby.pdf', quote: 'Houby nemají chlorofyl' },
          },
          {
            type: 'short_answer',
            payload: { prompt: 'Kolik nohou má houba?', answer: 'jednu' },
            evidence: { fileName: 'houby.pdf', quote: 'Houba má jednu nohu.' },
          },
        ],
      }),
    )
    expect(result?.created).toBe(1)
    expect(result?.rejected).toHaveLength(1)

    const saved = await db.select().from(questions).where(eq(questions.topicId, topicId))
    expect(saved.map((q) => q.model)).toEqual(['claude-code'])
    expect(saved.map((q) => q.status)).toEqual(['approved'])
  })

  it('the downloaded file carries the active school rules so Claude Code follows them too', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })
    await db.insert(promptRules).values({
      id: newId(),
      schoolId: ACCOUNT.schoolId,
      text: 'Nepoužívej otázky ano/ne.',
      active: true,
      createdBy: ACCOUNT.userId,
    })
    await db.insert(promptRules).values({
      id: newId(),
      schoolId: ACCOUNT.schoolId,
      text: 'Vypnuté pravidlo, tohle se do souboru nedostane.',
      active: false,
      createdBy: ACCOUNT.userId,
    })

    const source = await topicSourceFile(ACCOUNT, topicId)
    expect(schoolRulesFromSource(source!.text)).toEqual(['Nepoužívej otázky ano/ne.'])
  })

  it('a foreign topic looks nonexistent', async () => {
    const { topicId } = await seedTopic()
    const foreign = { ...ACCOUNT, schoolId: 'jina-skola' }
    expect(await topicSourceFile(foreign, topicId)).toBeNull()
    expect(await importQuestionFile(foreign, topicId, '[]')).toBeNull()
  })

  it('invalid JSON in the file is recognised as a file error, not a generic error', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })
    await expect(importQuestionFile(ACCOUNT, topicId, '{nejde')).rejects.toBeInstanceOf(QuestionFileError)
  })
})
