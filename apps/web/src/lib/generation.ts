import 'server-only'
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { generateQuestions } from '@testmaker/core/ai'
import { AI_QUESTION_TYPES, type Question, type QuestionType } from '@testmaker/core/schema'
import { db, generationJobs, grades, materials, questions, subjects, topics } from '@/db'
import { newId } from '@/lib/ids'
import { insertQuestions, questionPrompt, toQuestion } from './questions'

export interface GenerateParams {
  count: number
  types: QuestionType[]
  difficulty: 1 | 2 | 3 | 'mix'
  /**
   * `add` = vytvoř `count` nových otázek.
   * `target` = doplň téma tak, aby v něm bylo dohromady `count` otázek.
   * Doplňování je to, co učitelka chce u tématu, kde už něco má: po kontrole
   * konceptů část zamítne a potřebuje dorovnat počet, ne začínat znovu.
   */
  mode?: 'add' | 'target'
}

export const DEFAULT_GENERATE_PARAMS: GenerateParams = {
  count: 12,
  types: [...AI_QUESTION_TYPES],
  difficulty: 'mix',
  mode: 'add',
}

/**
 * Kolik otázek se má v tomhle běhu opravdu vytvořit. U doplňování se počítají
 * jen otázky, které v tématu zůstaly použitelné — zamítnuté se do počtu
 * nepočítají, jinak by doplnění nikdy nic nevytvořilo.
 */
export async function resolveCount(topicId: string, params: GenerateParams): Promise<number> {
  if (params.mode !== 'target') return params.count
  const [row] = await db
    .select({ value: sql<number>`count(*)` })
    .from(questions)
    .where(and(eq(questions.topicId, topicId), ne(questions.status, 'rejected')))
  return Math.max(0, params.count - Number(row?.value ?? 0))
}

export interface GenerateOutcome {
  created: number
  rejected: number
  /** Volání, ze kterých nešlo použít nic. */
  failedCalls: number
  topicId: string
  /** Z kolika materiálů se generovalo. */
  sources: number
}

/**
 * Zabere téma pro generování. Dvě generování nad týmž tématem naráz o sobě
 * nevědí — seznam „těmhle otázkám se vyhni" si každé načte na začátku, takže
 * by spolehlivě vyrobila duplicity. Rezervace se vede v téže tabulce jako
 * fronta, aby se hromadné generování a ruční spuštění viděly navzájem.
 *
 * Vrací id rezervace, nebo `null`, když už téma někdo zpracovává.
 */
export async function claimTopic(topicId: string): Promise<string | null> {
  const running = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(and(eq(generationJobs.topicId, topicId), inArray(generationJobs.status, ['queued', 'running'])))
    .limit(1)
  if (running.length > 0) return null

  const id = newId()
  await db.insert(generationJobs).values({
    id,
    topicId,
    params: DEFAULT_GENERATE_PARAMS,
    status: 'running',
    startedAt: new Date().toISOString(),
  })

  // Pojistka proti souběhu: kdyby rezervaci stihl založit i někdo další,
  // zůstane ta starší a tahle se uklidí.
  const others = await db
    .select({ id: generationJobs.id, createdAt: generationJobs.createdAt })
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.topicId, topicId),
        inArray(generationJobs.status, ['queued', 'running']),
        ne(generationJobs.id, id),
      ),
    )
  if (others.length > 0) {
    await db.delete(generationJobs).where(eq(generationJobs.id, id))
    return null
  }

  return id
}

/** Uvolní rezervaci tématu a zapíše, jak generování dopadlo. */
export async function releaseTopic(
  jobId: string,
  outcome: { created?: number; error?: string } = {},
): Promise<void> {
  await db
    .update(generationJobs)
    .set({
      status: outcome.error ? 'error' : 'done',
      error: outcome.error ?? null,
      producedCount: outcome.created ?? 0,
      finishedAt: new Date().toISOString(),
    })
    .where(eq(generationJobs.id, jobId))
}

/** Text celé skupiny materiálů jednoho tématu, s hlavičkami podle souborů. */
export async function loadTopicSource(topicId: string): Promise<{
  text: string
  topicName: string
  gradeName: string
  subjectName: string
  sources: number
} | null> {
  const [meta] = await db
    .select({ topicName: topics.name, gradeName: grades.name, subjectName: subjects.name })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(eq(topics.id, topicId))
    .limit(1)
  if (!meta) return null

  // Duplicitní exporty téhož obsahu do zdroje nepatří — jen by otázky zdvojily.
  const rows = await db
    .select({ fileName: materials.fileName, text: materials.text })
    .from(materials)
    .where(and(eq(materials.topicId, topicId), isNull(materials.duplicateOfId)))
    .orderBy(asc(materials.fileName))

  const text = rows
    .map((row) => `=== ${row.fileName} ===\n${row.text}`)
    .join('\n\n')
    .trim()

  return { ...meta, text, sources: rows.length }
}

/**
 * Vygeneruje otázky z celé skupiny materiálů jednoho tématu.
 * Jeden soubor často na písemku nestačí a generování po souborech vede
 * k opakujícím se otázkám, proto je vstupem vždy celé téma.
 */
export async function generateForTopic(
  topicId: string,
  params: GenerateParams,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<GenerateOutcome> {
  const wanted = await resolveCount(topicId, params)
  if (wanted <= 0) {
    return { created: 0, rejected: 0, failedCalls: 0, topicId, sources: 0 }
  }

  const source = await loadTopicSource(topicId)
  if (!source) throw new Error('Téma nenalezeno')
  if (source.text.trim().length < 200) {
    throw new Error('Materiály tématu obsahují příliš málo textu na generování otázek')
  }

  const existing = await db.select().from(questions).where(eq(questions.topicId, topicId)).limit(80)

  // Ukládáme po dávkách. Kdyby volání modelu v půlce selhalo, zůstane hotová práce.
  let created = 0
  const result = await generateQuestions(
    {
      text: source.text,
      topicName: source.topicName,
      subjectName: source.subjectName,
      gradeName: source.gradeName || null,
      count: wanted,
      types: params.types,
      difficulty: params.difficulty,
      avoid: existing.map((item) => questionPrompt(toQuestion(item))),
    },
    {
      signal: options.signal,
      onChunk: options.onProgress,
      onBatch: async (batch) => {
        await insertQuestions(batch, { topicId, source: 'ai', status: 'draft' })
        created += batch.length
      },
    },
  )

  return {
    created,
    rejected: result.rejected.length,
    failedCalls: result.failedCalls.length,
    topicId,
    sources: source.sources,
  }
}

/**
 * Běží nad tématem právě dávkové generování? Náhrada jedné otázky si téma
 * nerezervuje (`claimTopic`) — kvůli jedné otázce by zablokovala celé téma na
 * několik minut. Čte ale rezervaci cizí: kdyby se náhrada trefila doprostřed
 * dávky, obě volání by pracovala se stejným seznamem „těmhle se vyhni".
 */
export async function isTopicBusy(topicId: string): Promise<boolean> {
  const running = await db
    .select({ id: generationJobs.id })
    .from(generationJobs)
    .where(and(eq(generationJobs.topicId, topicId), inArray(generationJobs.status, ['queued', 'running'])))
    .limit(1)
  return running.length > 0
}

export const TOPIC_BUSY_MESSAGE =
  'Nad tímhle tématem právě běží generování. Počkej, než doběhne, a zkus to znovu.'

/**
 * Nahradí jednu otázku novou od modelu.
 *
 * Pořadí je to podstatné: nejdřív musí náhrada vzniknout, teprve pak se
 * původní otázka označí jako zamítnutá. Když model selže nebo vrátí něco
 * nepoužitelného, nezmění se v databázi nic a volající dostane českou hlášku
 * (`describeAiError`) — jinak by po nepovedeném pokusu zůstalo v tématu o
 * jednu otázku míň a učitelka by nevěděla, kam se poděla.
 *
 * `generate` se dá podstrčit v testech; v aplikaci se nepředává.
 */
export async function regenerateQuestion(
  questionId: string,
  options: { signal?: AbortSignal; generate?: typeof generateQuestions } = {},
): Promise<Question> {
  const [original] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1)
  if (!original) throw new Error('Otázka nenalezena')
  if (!original.topicId) throw new Error('Otázka nepatří k žádnému tématu, nemá se z čeho generovat náhrada')

  const topicId = original.topicId
  if (await isTopicBusy(topicId)) throw new Error(TOPIC_BUSY_MESSAGE)

  const type = original.type
  if (!AI_QUESTION_TYPES.includes(type as (typeof AI_QUESTION_TYPES)[number])) {
    throw new Error('Tenhle typ otázky model generovat neumí, uprav ji prosím ručně')
  }

  const source = await loadTopicSource(topicId)
  if (!source) throw new Error('Téma nenalezeno')
  if (source.text.trim().length < 200) {
    throw new Error('Materiály tématu obsahují příliš málo textu na generování otázek')
  }

  // Nahrazovaná otázka je v seznamu „vyhni se" taky — jinak by model klidně
  // vrátil tutéž otázku, kterou učitelka právě zavrhla.
  const existing = await db.select().from(questions).where(eq(questions.topicId, topicId)).limit(80)

  const generate = options.generate ?? generateQuestions
  const result = await generate(
    {
      text: source.text,
      topicName: source.topicName,
      subjectName: source.subjectName,
      gradeName: source.gradeName || null,
      count: 1,
      types: [type as (typeof AI_QUESTION_TYPES)[number]],
      difficulty: (original.difficulty as 1 | 2 | 3) ?? 2,
      avoid: existing.map((item) => questionPrompt(toQuestion(item))),
    },
    { signal: options.signal },
  )

  const replacement = result.questions[0]
  if (!replacement) {
    throw new Error('Model nevrátil použitelnou náhradu. Zkus to prosím znovu.')
  }

  // Až teď — náhrada je na světě, původní otázka může odejít.
  const [newId] = await insertQuestions([replacement], { topicId, source: 'ai', status: 'draft' })
  await db.update(questions).set({ status: 'rejected' }).where(eq(questions.id, questionId))

  const [row] = await db.select().from(questions).where(eq(questions.id, newId!)).limit(1)
  if (!row) throw new Error('Náhradu se nepodařilo uložit')
  return toQuestion(row)
}
