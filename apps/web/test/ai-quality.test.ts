import { beforeEach, describe, expect, it } from 'vitest'
import { db, questionFeedback, questions, schools, users } from '@/db'
import { loadAiQuality } from '@/lib/aiQuality'
import { newId } from '@/lib/ids'
import { searchTextFor } from '@/lib/questions'
import { seedTopic, UCET } from './helpers'
import { TEST_SKOLA_ID } from './setup'

const CIZI_SKOLA = 'skola-jina-ai-kvalita'

/** Uživatel jiné školy — pro `created_by`, aby vložení otázky prošlo cizím klíčem. */
async function ciziUcet(): Promise<string> {
  await db.insert(schools).values({ id: CIZI_SKOLA, name: 'Jiná škola', slug: 'jina-ai-kvalita' }).onConflictDoNothing()
  const id = newId()
  await db.insert(users).values({ id, schoolId: CIZI_SKOLA, email: `${id}@jina.cz`, name: 'Cizí učitelka', role: 'spravce' })
  return id
}

/**
 * Přehled „AI kvalita" ve Správě: kolik otázek který model vygeneroval a kolik
 * jich učitelky nakonec přegenerovaly, nejčastější důvody a předměty, kde se
 * přegeneruje nejvíc. Testy sestavují data přímo přes `db`, protože potřebují
 * řídit model a datum vzniku, což `seedQuestion` nenabízí.
 */

const DEN = 24 * 60 * 60 * 1000

/** Otázka v bance s konkrétním modelem, zdrojem a datem vzniku. */
async function seedAiQuestion(
  topicId: string | null,
  options: {
    model?: string | null
    source?: 'ai' | 'manual'
    createdAt?: string
    schoolId?: string
  } = {},
): Promise<string> {
  const id = newId()
  const payload = { prompt: 'Otázka', options: ['a', 'b'], correctIndex: 0 }
  const schoolId = options.schoolId ?? TEST_SKOLA_ID
  await db.insert(questions).values({
    id,
    schoolId,
    createdBy: schoolId === TEST_SKOLA_ID ? UCET.userId : await ciziUcet(),
    topicId,
    materialId: null,
    type: 'single_choice',
    payload,
    blocks: [],
    points: 1,
    difficulty: 2,
    source: options.source ?? 'ai',
    model: options.model ?? null,
    status: 'approved',
    createdAt: options.createdAt,
    searchText: searchTextFor({ payload }),
  })
  return id
}

/** Řádek zpětné vazby z přegenerování. */
async function seedFeedback(options: {
  questionId?: string | null
  model?: string | null
  reason?: 'nesmysl' | 'moznosti' | 'mimo' | 'tezka' | 'lehka' | 'cestina' | null
  createdAt?: string
  schoolId?: string
}): Promise<string> {
  const id = newId()
  await db.insert(questionFeedback).values({
    id,
    schoolId: options.schoolId ?? TEST_SKOLA_ID,
    questionId: options.questionId ?? null,
    replacementId: null,
    model: options.model ?? null,
    reason: options.reason ?? null,
    note: null,
    createdBy: UCET.userId,
    createdAt: options.createdAt,
  })
  return id
}

beforeEach(async () => {
  await db.delete(questionFeedback)
  await db.delete(questions)
})

describe('loadAiQuality', () => {
  it('sečte vygenerované a přegenerované otázky podle modelu', async () => {
    const { topicId } = await seedTopic()
    const q1 = await seedAiQuestion(topicId, { model: 'google:gemini-flash-latest' })
    await seedAiQuestion(topicId, { model: 'google:gemini-flash-latest' })
    await seedAiQuestion(topicId, { model: 'openai:gpt-5' })

    await seedFeedback({ questionId: q1, model: 'google:gemini-flash-latest', reason: 'tezka' })

    const prehled = await loadAiQuality(UCET)
    const gemini = prehled.models.find((row) => row.model === 'google:gemini-flash-latest')
    const gpt = prehled.models.find((row) => row.model === 'openai:gpt-5')

    expect(gemini).toEqual({ model: 'google:gemini-flash-latest', generated: 2, regenerated: 1 })
    expect(gpt).toEqual({ model: 'openai:gpt-5', generated: 1, regenerated: 0 })
  })

  it('sečte nejčastější důvody přegenerování včetně přegenerování bez důvodu', async () => {
    const { topicId } = await seedTopic()
    const q1 = await seedAiQuestion(topicId, { model: 'm' })
    const q2 = await seedAiQuestion(topicId, { model: 'm' })
    const q3 = await seedAiQuestion(topicId, { model: 'm' })

    await seedFeedback({ questionId: q1, model: 'm', reason: 'tezka' })
    await seedFeedback({ questionId: q2, model: 'm', reason: 'tezka' })
    await seedFeedback({ questionId: q3, model: 'm', reason: null })

    const prehled = await loadAiQuality(UCET)
    expect(prehled.reasons[0]).toEqual({ reason: 'tezka', count: 2 })
    expect(prehled.reasons.find((row) => row.reason === null)).toEqual({ reason: null, count: 1 })
  })

  it('otázky a zpětná vazba jiné školy se nezapočítají', async () => {
    const { topicId } = await seedTopic()
    await seedAiQuestion(topicId, { model: 'moje' })

    const cizi = await seedAiQuestion(null, { model: 'cizi', schoolId: CIZI_SKOLA })
    await seedFeedback({ questionId: cizi, model: 'cizi', reason: 'tezka', schoolId: CIZI_SKOLA })

    const prehled = await loadAiQuality(UCET)
    expect(prehled.models.find((row) => row.model === 'cizi')).toBeUndefined()
    expect(prehled.reasons).toEqual([])
  })

  it('starší otázky bez modelu se v přehledu ukážou jako „neznámý model"', async () => {
    const { topicId } = await seedTopic()
    const q = await seedAiQuestion(topicId, { model: null })
    await seedFeedback({ questionId: q, model: null, reason: null })

    const prehled = await loadAiQuality(UCET)
    const neznamy = prehled.models.find((row) => row.model === 'neznámý model')
    expect(neznamy).toEqual({ model: 'neznámý model', generated: 1, regenerated: 1 })
  })

  it('otázky mimo výchozí okno 90 dní se nezapočítají', async () => {
    const { topicId } = await seedTopic()
    const stary = new Date(Date.now() - 120 * DEN).toISOString()
    await seedAiQuestion(topicId, { model: 'staré', createdAt: stary })

    const prehled = await loadAiQuality(UCET)
    expect(prehled.models.find((row) => row.model === 'staré')).toBeUndefined()
  })

  it('model má vlastní okno pro generování a pro přegenerování — otázka mimo okno, přegenerování uvnitř dá generated: 0', async () => {
    const { topicId } = await seedTopic()
    const stary = new Date(Date.now() - 120 * DEN).toISOString()
    const q = await seedAiQuestion(topicId, { model: 'stary-model', createdAt: stary })
    // Zpětná vazba vzniká dnes (výchozí `createdAt`), i když otázka vznikla
    // dávno mimo okno — každé číslo se počítá podle vlastního data.
    await seedFeedback({ questionId: q, model: 'stary-model', reason: 'tezka' })

    const prehled = await loadAiQuality(UCET)
    expect(prehled.models.find((row) => row.model === 'stary-model')).toEqual({
      model: 'stary-model',
      generated: 0,
      regenerated: 1,
    })
  })

  it('vlastní zadané období (`since`) se použije místo výchozích 90 dní', async () => {
    const { topicId } = await seedTopic()
    const stary = new Date(Date.now() - 120 * DEN).toISOString()
    await seedAiQuestion(topicId, { model: 'staré', createdAt: stary })

    const prehled = await loadAiQuality(UCET, { since: new Date(Date.now() - 200 * DEN).toISOString() })
    expect(prehled.models.find((row) => row.model === 'staré')?.generated).toBe(1)
  })

  it('spočítá předměty s nejvíc přegenerováním a jejich nejčastější důvod', async () => {
    const prirodopis = await seedTopic({ subject: 'Přírodopis' })
    const dejepis = await seedTopic({ subject: 'Dějepis' })

    const p1 = await seedAiQuestion(prirodopis.topicId, { model: 'm' })
    const p2 = await seedAiQuestion(prirodopis.topicId, { model: 'm' })
    const d1 = await seedAiQuestion(dejepis.topicId, { model: 'm' })

    await seedFeedback({ questionId: p1, model: 'm', reason: 'tezka' })
    await seedFeedback({ questionId: p2, model: 'm', reason: 'tezka' })
    await seedFeedback({ questionId: d1, model: 'm', reason: 'mimo' })

    const prehled = await loadAiQuality(UCET)
    expect(prehled.bySubject[0]).toEqual({ subject: 'Přírodopis', regenerated: 2, topReason: 'tezka' })
    expect(prehled.bySubject[1]).toEqual({ subject: 'Dějepis', regenerated: 1, topReason: 'mimo' })
  })

  it('bez zpětné vazby vrátí prázdné seznamy', async () => {
    const prehled = await loadAiQuality(UCET)
    expect(prehled.reasons).toEqual([])
    expect(prehled.bySubject).toEqual([])
  })
})
