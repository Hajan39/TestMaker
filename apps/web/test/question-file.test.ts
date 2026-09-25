import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { QuestionFileError } from '@testmaker/core/ai'
import { db, questions } from '@/db'
import { importQuestionFile, topicSourceFile } from '@/lib/questionFile'
import { seedMaterial, seedTopic, UCET } from './helpers'

const TEXT = 'Houby nemají chlorofyl, a proto si potravu nevyrábějí samy. '.repeat(8)

describe('otázky z Claude Code', () => {
  it('stáhne text tématu s hlavičkou a nahraje zpátky jen platné otázky', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })

    const zdroj = await topicSourceFile(UCET, topicId)
    expect(zdroj?.text).toContain('=== houby.pdf ===')
    expect(zdroj?.text).toMatch(/^# Předmět: /)

    const vysledek = await importQuestionFile(
      UCET,
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
    expect(vysledek?.created).toBe(1)
    expect(vysledek?.rejected).toHaveLength(1)

    const ulozene = await db.select().from(questions).where(eq(questions.topicId, topicId))
    expect(ulozene.map((q) => q.model)).toEqual(['claude-code'])
  })

  it('cizí téma se tváří jako neexistující', async () => {
    const { topicId } = await seedTopic()
    const cizi = { ...UCET, schoolId: 'jina-skola' }
    expect(await topicSourceFile(cizi, topicId)).toBeNull()
    expect(await importQuestionFile(cizi, topicId, '[]')).toBeNull()
  })

  it('nevalidní JSON v souboru se pozná jako chyba souboru, ne obecná chyba', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'houby.pdf', text: TEXT })
    await expect(importQuestionFile(UCET, topicId, '{nejde')).rejects.toBeInstanceOf(QuestionFileError)
  })
})
