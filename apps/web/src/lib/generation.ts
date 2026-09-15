import 'server-only'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { generateQuestions } from '@testmaker/core/ai'
import { AI_QUESTION_TYPES, type QuestionType } from '@testmaker/core/schema'
import { db, grades, materials, questions, subjects, topics } from '@/db'
import { insertQuestions, questionPrompt, toQuestion } from './questions'

export interface GenerateParams {
  count: number
  types: QuestionType[]
  difficulty: 1 | 2 | 3 | 'mix'
}

export const DEFAULT_GENERATE_PARAMS: GenerateParams = {
  count: 12,
  types: [...AI_QUESTION_TYPES],
  difficulty: 'mix',
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
      count: params.count,
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
