import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QuestionContent } from '@testmaker/core/schema'
import type { generateQuestions } from '@testmaker/core/ai'
import { db, generationJobs, promptRules, questionFeedback, questions } from '@/db'
import { topicBusyMessage, regenerateQuestion } from '@/lib/generation'
import { newId } from '@/lib/ids'
import { createPromptRule, setPromptRuleActive } from '@/lib/promptRules'
import { POST } from '@/app/api/questions/regenerate/route'
import { jsonReq, seedMaterial, seedQuestion, seedTopic, seedUcet, UCET } from './helpers'

/** Prostředí s klíčem — testy na API vrstvě volání modelu stejně nespouštějí. */
function withKey(): void {
  vi.stubEnv('AI_MODELS', 'google:gemini-flash-latest')
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-key')
}

/** Materiál musí mít dost textu, jinak se generování odmítne ještě před modelem. */
const TEXT =
  'Koloběh vody v přírodě zahrnuje výpar, vznik oblaků, srážky a odtok vody zpět do moří a oceánů. '.repeat(
    6,
  )

const NAHRADA: QuestionContent = {
  type: 'single_choice',
  payload: { prompt: 'Čím je poháněn koloběh vody?', options: ['Sluncem', 'Větrem'], correctIndex: 0 },
  blocks: [],
  points: 1,
  difficulty: 2,
}

/** Podvržený poskytovatel: model, který vrátí přesně tuhle jednu otázku. */
const modelVrati: typeof generateQuestions = async () => ({
  questions: [NAHRADA],
  rejected: [],
  chunks: 1,
  failedCalls: [],
  models: ['google:gemini-flash-latest'],
})

/** Podvržený poskytovatel, kterému se volání nepovede (vyčerpaná kvóta). */
const modelSelze: typeof generateQuestions = async () => {
  throw new Error('You exceeded your current quota, please check your plan')
}

/** Podvržený poskytovatel, který odpoví, ale nic použitelného nevrátí. */
const modelVratiNic: typeof generateQuestions = async () => ({
  questions: [],
  rejected: [{ index: 0, errors: ['nesmysl'] }],
  chunks: 1,
  failedCalls: [],
  models: ['google:gemini-flash-latest'],
})

/** Stavy otázek jednoho tématu — soubor testů sdílí jednu databázi. */
async function stavy(topicId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: questions.id, status: questions.status })
    .from(questions)
    .where(eq(questions.topicId, topicId))
  return new Map(rows.map((row) => [row.id, row.status]))
}

beforeEach(async () => {
  await db.delete(promptRules)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('náhrada jedné otázky modelem', () => {
  it('předá modelu citaci nahrazované otázky, ať náhrada vznikne ze stejné pasáže', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })
    await db
      .update(questions)
      .set({ sourceFile: 'voda.pdf', sourceQuote: 'srážky a odtok vody zpět do moří' })
      .where(eq(questions.id, original))

    let focus: string | undefined = 'nezavoláno'
    await regenerateQuestion(UCET, original, {
      generate: async (request, options) => {
        focus = request.focus
        return modelVrati(request, options)
      },
    })
    expect(focus).toBe('srážky a odtok vody zpět do moří')
  })

  it('bez citace u původní otázky se focus nepředává', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })

    let focus: string | undefined = 'nezavoláno'
    await regenerateQuestion(UCET, original, {
      generate: async (request, options) => {
        focus = request.focus
        return modelVrati(request, options)
      },
    })
    expect(focus).toBeUndefined()
  })

  it('nejdřív vznikne náhrada, teprve pak se původní zamítne', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })

    const replacement = await regenerateQuestion(UCET, original, { generate: modelVrati })

    expect(replacement.id).not.toBe(original)
    // Náhrada je rovnou použitelná — schvalování konceptů zmizelo.
    expect(replacement.status).toBe('approved')
    expect(replacement.topicId).toBe(topicId)

    const stav = await stavy(topicId)
    expect(stav.get(original)).toBe('rejected')
    expect(stav.get(replacement.id)).toBe('approved')
  })

  it('když model selže, nezmění se v databázi vůbec nic', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })
    const pred = await stavy(topicId)

    await expect(regenerateQuestion(UCET, original, { generate: modelSelze })).rejects.toThrow(/quota/)

    const po = await stavy(topicId)
    expect(po).toEqual(pred)
    // Žádná nedopsaná otázka navíc: kdyby tu přibyla, seznam by byl delší.
    expect(po.size).toBe(1)
  })

  it('nepoužitelná odpověď modelu původní otázku nezamítne a vysvětlí se česky', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'draft' })

    await expect(regenerateQuestion(UCET, original, { generate: modelVratiNic })).rejects.toThrow(
      /Model nevrátil použitelnou náhradu/,
    )

    const po = await stavy(topicId)
    expect(po.get(original)).toBe('draft')
    expect(po.size).toBe(1)
  })

  it('nad tématem s běžícím dávkovým generováním se odmítne a téma nezablokuje', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { prompt: 'Špatná otázka', status: 'approved' })

    await db.insert(generationJobs).values({
      id: newId(),
      schoolId: UCET.schoolId,
      requestedBy: UCET.userId,
      topicId,
      params: { count: 5, types: ['single_choice'], difficulty: 'mix' },
      status: 'running',
    })

    await expect(regenerateQuestion(UCET, original, { generate: modelVrati })).rejects.toThrow(topicBusyMessage('Testovací správce'))

    // Rezervace zůstala jediná — náhrada si téma nezabrala pro sebe.
    const jobs = await db.select().from(generationJobs).where(eq(generationJobs.topicId, topicId))
    expect(jobs).toHaveLength(1)
    expect((await stavy(topicId)).get(original)).toBe('approved')
  })

  it('otázku bez tématu nahradit nejde — nemá se z čeho generovat', async () => {
    const orphan = await seedQuestion(null, { status: 'draft' })
    await expect(regenerateQuestion(UCET, orphan, { generate: modelVrati })).rejects.toThrow(/téma/)
  })
})

describe('důvod přegenerování ovlivňuje obtížnost náhrady', () => {
  it('"moc těžká" obtížnost sníží', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, original))

    let difficulty: unknown = 'nezavoláno'
    await regenerateQuestion(UCET, original, {
      reason: 'tezka',
      generate: async (request, options) => {
        difficulty = request.difficulty
        return modelVrati(request, options)
      },
    })
    expect(difficulty).toBe(1)
  })

  it('"moc těžká" u obtížnosti 1 se nepřehoupne pod stupnici', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })
    await db.update(questions).set({ difficulty: 1 }).where(eq(questions.id, original))

    let difficulty: unknown = 'nezavoláno'
    await regenerateQuestion(UCET, original, {
      reason: 'tezka',
      generate: async (request, options) => {
        difficulty = request.difficulty
        return modelVrati(request, options)
      },
    })
    expect(difficulty).toBe(1)
  })

  it('"moc lehká" u obtížnosti 3 se nepřehoupne nad stupnici', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })
    await db.update(questions).set({ difficulty: 3 }).where(eq(questions.id, original))

    let difficulty: unknown = 'nezavoláno'
    await regenerateQuestion(UCET, original, {
      reason: 'lehka',
      generate: async (request, options) => {
        difficulty = request.difficulty
        return modelVrati(request, options)
      },
    })
    expect(difficulty).toBe(3)
  })

  it('důvod bez posunu (např. "špatná čeština") obtížnost nemění', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })
    await db.update(questions).set({ difficulty: 2 }).where(eq(questions.id, original))

    let difficulty: unknown = 'nezavoláno'
    await regenerateQuestion(UCET, original, {
      reason: 'cestina',
      generate: async (request, options) => {
        difficulty = request.difficulty
        return modelVrati(request, options)
      },
    })
    expect(difficulty).toBe(2)
  })
})

describe('pravidla školy se předají generování náhrady', () => {
  it('jen aktivní pravidla vlastní školy, vypnuté ani cizí ne', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })

    const aktivni = await createPromptRule(UCET, { text: 'Piš kratší zadání.' })
    const vypnute = await createPromptRule(UCET, { text: 'Tohle se nepoužije.' })
    await setPromptRuleActive(UCET, vypnute.id, false)

    let schoolRules: string[] | undefined
    await regenerateQuestion(UCET, original, {
      generate: async (request, options) => {
        schoolRules = request.schoolRules
        return modelVrati(request, options)
      },
    })
    expect(schoolRules).toEqual([aktivni.text])
  })
})

describe('zpětná vazba z přegenerování', () => {
  it('po náhradě vznikne řádek s modelem nahrazené otázky, i bez důvodu', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })
    await db
      .update(questions)
      .set({ model: 'google:gemini-flash-latest' })
      .where(eq(questions.id, original))

    const replacement = await regenerateQuestion(UCET, original, { generate: modelVrati })

    const [feedback] = await db
      .select()
      .from(questionFeedback)
      .where(eq(questionFeedback.questionId, original))
    expect(feedback).toBeDefined()
    expect(feedback!.replacementId).toBe(replacement.id)
    expect(feedback!.model).toBe('google:gemini-flash-latest')
    expect(feedback!.reason).toBeNull()
    expect(feedback!.note).toBeNull()
  })

  it('s vyplněným důvodem a poznámkou se obojí uloží', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })

    await regenerateQuestion(UCET, original, {
      reason: 'nesmysl',
      note: 'Ptá se na dvě věci najednou.',
      generate: modelVrati,
    })

    const [feedback] = await db
      .select()
      .from(questionFeedback)
      .where(eq(questionFeedback.questionId, original))
    expect(feedback!.reason).toBe('nesmysl')
    expect(feedback!.note).toBe('Ptá se na dvě věci najednou.')
  })

  it('vlastní (ne AI) otázka žádnou zpětnou vazbu nezaloží — nemá co říct o modelu', async () => {
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'approved', source: 'manual' })

    await regenerateQuestion(UCET, original, { generate: modelVrati })

    const rows = await db.select().from(questionFeedback).where(eq(questionFeedback.questionId, original))
    expect(rows).toHaveLength(0)
  })
})

describe('API náhrady: neplatný důvod a role bez zápisu', () => {
  it('neplatný důvod v těle požadavku je 400', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })

    const response = await POST(
      jsonReq('/api/questions/regenerate', 'POST', { id: original, reason: 'neexistujici-duvod' }),
    )
    expect(response.status).toBe(400)
  })

  it('poznámka bez důvodu je 400 s českou hláškou — bez důvodu nemá poznámka kam patřit', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })

    const response = await POST(
      jsonReq('/api/questions/regenerate', 'POST', { id: original, note: 'Bez vybraného důvodu.' }),
    )
    expect(response.status).toBe(400)
    const data = (await response.json()) as { error?: string }
    expect(data.error).toMatch(/[Dd]ůvod/)
  })

  it('náhled otázku přegenerovat nesmí — 403', async () => {
    withKey()
    const { topicId } = await seedTopic()
    await seedMaterial(topicId, { text: TEXT })
    const original = await seedQuestion(topicId, { status: 'draft' })
    vi.stubEnv('E2E_UZIVATEL', (await seedUcet({ role: 'nahled' })).userId)

    const response = await POST(jsonReq('/api/questions/regenerate', 'POST', { id: original }))
    expect(response.status).toBe(403)
  })
})
