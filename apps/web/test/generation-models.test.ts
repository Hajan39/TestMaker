import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { generateQuestions } from '@testmaker/core/ai'
import type { QuestionContent } from '@testmaker/core/schema'
import { db, materials, promptRules, topics, questions } from '@/db'
import { generateForTopic, DEFAULT_GENERATE_PARAMS, loadTopicSource } from '@/lib/generation'
import { recomputeTopicContent } from '@/lib/duplicates'
import { topicSourceFile } from '@/lib/questionFile'
import { createPromptRule } from '@/lib/promptRules'
import { seedMaterial, seedTopic, UCET } from './helpers'

beforeEach(async () => {
  await db.delete(promptRules)
})

/**
 * Žebříček modelů pohledem aplikace: co se uložilo do databáze, když prvnímu
 * modelu dojde limit uprostřed tématu. Skutečný model se tu nevolá — generování
 * se podstrkuje, aby testy nespotřebovávaly limit.
 */

const TEXT =
  'Koloběh vody v přírodě zahrnuje výpar, vznik oblaků, srážky a odtok vody zpět do moří a oceánů. '.repeat(6)

function otazka(poradi: number): QuestionContent {
  return {
    type: 'short_answer',
    payload: { prompt: `Otázka číslo ${poradi}?`, answer: 'odpověď', acceptedAnswers: [] },
    blocks: [],
    points: 1,
    difficulty: 2,
  }
}

/**
 * Podvržené generování, které se chová jako `generateQuestions` po vyčerpaném
 * limitu: první dávku vyrobí první model, druhou až ten další ze žebříčku.
 */
const dvaModely: typeof generateQuestions = async (_request, options) => {
  const prvni = [otazka(1), otazka(2)]
  const druha = [otazka(3), otazka(4)]
  await options?.onBatch?.(prvni, { model: 'google:gemini-flash-latest' })
  await options?.onBatch?.(druha, { model: 'google:gemini-flash-lite-latest' })
  return {
    questions: [...prvni, ...druha],
    rejected: [],
    chunks: 1,
    failedCalls: [],
    models: ['google:gemini-flash-latest', 'google:gemini-flash-lite-latest'],
  }
}

describe('generování tématu se žebříčkem modelů', () => {
  it('uloží otázky z obou modelů a vrátí, které se použily', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    const outcome = await generateForTopic(UCET, 
      topicId,
      { ...DEFAULT_GENERATE_PARAMS, count: 4 },
      { generate: dvaModely },
    )

    expect(outcome.created).toBe(4)
    // Kvalita se mezi modely liší — z výsledku musí být poznat, že se míchaly.
    expect(outcome.models).toEqual(['google:gemini-flash-latest', 'google:gemini-flash-lite-latest'])

    const rows = await db
      .select({ model: questions.model, status: questions.status })
      .from(questions)
      .where(eq(questions.topicId, topicId))
    expect(rows).toHaveLength(4)
    // Model se ukládá k otázce, ale jen do databáze — v rozhraní se nikde nebere.
    expect(rows.filter((row) => row.model === 'google:gemini-flash-latest')).toHaveLength(2)
    expect(rows.filter((row) => row.model === 'google:gemini-flash-lite-latest')).toHaveLength(2)
    // Otázky vznikají rovnou použitelné, ne jako koncept ke schválení.
    expect(rows.every((row) => row.status === 'approved')).toBe(true)
  })

  it('když generování v půlce spadne, hotové dávky zůstanou uložené', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })

    // Celý žebříček došel: první dávka je uložená, druhá už nevznikla.
    const spadneAzPoPrvniDavce: typeof generateQuestions = async (_request, options) => {
      await options?.onBatch?.([otazka(1), otazka(2)], { model: 'google:gemini-flash-latest' })
      throw new Error('You exceeded your current quota, please check your plan')
    }

    await expect(
      generateForTopic(UCET, topicId, { ...DEFAULT_GENERATE_PARAMS, count: 4 }, { generate: spadneAzPoPrvniDavce }),
    ).rejects.toThrow(/quota/)

    const rows = await db.select({ id: questions.id, model: questions.model }).from(questions).where(eq(questions.topicId, topicId))
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.model === 'google:gemini-flash-latest')).toBe(true)
  })
})

describe('pravidla školy se předají dávkovému generování', () => {
  it('aktivní pravidlo je v požadavku na model', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    await createPromptRule(UCET, { text: 'Piš kratší zadání.' })

    let schoolRules: string[] | undefined
    await generateForTopic(UCET, topicId, { ...DEFAULT_GENERATE_PARAMS, count: 2 }, {
      generate: async (request, options) => {
        schoolRules = request.schoolRules
        await options?.onBatch?.([otazka(1), otazka(2)], { model: 'google:gemini-flash-latest' })
        return { questions: [otazka(1), otazka(2)], rejected: [], chunks: 1, failedCalls: [], models: ['google:gemini-flash-latest'] }
      },
    })
    expect(schoolRules).toEqual(['Piš kratší zadání.'])
  })
})

describe('vynechaný materiál do generování nejde', () => {
  it('loadTopicSource i soubor pro Claude Code vynechaný materiál přeskočí', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { fileName: 'pouzity.txt', text: TEXT })
    const vynechanyId = await seedMaterial(topicId, { fileName: 'vynechany.txt', text: TEXT })
    await db.update(materials).set({ excluded: true }).where(eq(materials.id, vynechanyId))

    const source = await loadTopicSource(UCET, topicId)
    expect(source?.text).not.toContain('vynechany.txt')
    expect(source?.text).toContain('pouzity.txt')
    expect(source?.sources).toBe(1)

    const soubor = await topicSourceFile(UCET, topicId)
    expect(soubor?.text).not.toContain('vynechany.txt')
  })

  it('usableCharCount vynechaný materiál nepočítá', async () => {
    const { topicId } = await seedTopic()
    const materialId = await seedMaterial(topicId, { text: TEXT })
    await db.update(materials).set({ excluded: true }).where(eq(materials.id, materialId))

    await recomputeTopicContent(UCET, topicId)
    const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1)
    expect(topic!.usableCharCount).toBe(0)
    expect(topic!.lowContent).toBe(true)
  })
})
