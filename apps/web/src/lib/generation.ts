import 'server-only'
import { eq } from 'drizzle-orm'
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
  topicId: string
}

/**
 * Vygeneruje otázky k jednomu materiálu a uloží je jako koncepty.
 * Už existující otázky k tématu předá modelu jako seznam, kterému se má vyhnout.
 */
export async function generateForMaterial(
  materialId: string,
  params: GenerateParams,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<GenerateOutcome> {
  const [row] = await db
    .select({
      material: materials,
      topicName: topics.name,
      gradeName: grades.name,
      subjectName: subjects.name,
    })
    .from(materials)
    .innerJoin(topics, eq(topics.id, materials.topicId))
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(eq(materials.id, materialId))
    .limit(1)

  if (!row) throw new Error('Materiál nenalezen')
  if (row.material.duplicateOfId) {
    throw new Error(
      'Tento materiál je jiný export už naimportovaného obsahu. Generuj z původního materiálu.',
    )
  }
  if (row.material.text.trim().length < 200) {
    throw new Error('Materiál obsahuje příliš málo textu na generování otázek')
  }

  const existing = await db
    .select()
    .from(questions)
    .where(eq(questions.topicId, row.material.topicId))
    .limit(60)

  const result = await generateQuestions(
    {
      text: row.material.text,
      topicName: row.topicName,
      subjectName: row.subjectName,
      gradeName: row.gradeName || null,
      count: params.count,
      types: params.types,
      difficulty: params.difficulty,
      avoid: existing.map((item) => questionPrompt(toQuestion(item))),
    },
    { signal: options.signal, onChunk: options.onProgress },
  )

  await insertQuestions(result.questions, {
    topicId: row.material.topicId,
    materialId: row.material.id,
    source: 'ai',
    status: 'draft',
  })

  return {
    created: result.questions.length,
    rejected: result.rejected.length,
    topicId: row.material.topicId,
  }
}
