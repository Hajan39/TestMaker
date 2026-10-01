import 'server-only'
import { inArray } from 'drizzle-orm'
import { buildTopicSourceFile, CLAUDE_CODE_MODEL, readQuestionFile } from '@testmaker/core/ai'
import { db, questions } from '@/db'
import { loadTopicSource } from './generation'
import { insertQuestions, loadAvoidPrompts } from './questions'
import { loadActivePromptRules } from './promptRules'
import type { Scope } from './user'

/**
 * Topic text to download for Claude Code (`/otazky`). The same text the model
 * gets when generating in the app, with a header about the grade, questions
 * already in the topic and the school's active rules — otherwise Claude Code
 * wouldn't know them (the `otazky:pravidla` script has no database). Foreign
 * topic → `null`.
 */
export async function topicSourceFile(scope: Scope, topicId: string): Promise<{ fileName: string; text: string } | null> {
  const source = await loadTopicSource(scope, topicId)
  if (!source) return null
  const existing = await loadAvoidPrompts(scope, topicId)
  const schoolRules = await loadActivePromptRules(scope)
  return {
    fileName: `${source.topicName}.txt`,
    text: buildTopicSourceFile({
      subjectName: source.subjectName,
      gradeName: source.gradeName || null,
      topicName: source.topicName,
      text: source.text,
      existing,
      schoolRules,
    }),
  }
}

/**
 * Imports questions from a Claude Code file. Validation is the same as for
 * generation (shape, verbatim quote, duplicates); whatever fails is returned
 * with a reason. Foreign topic → `null`.
 */
export async function importQuestionFile(
  scope: Scope,
  topicId: string,
  json: string,
): Promise<{ created: number; rejected: { index: number; errors: string[] }[] } | null> {
  const source = await loadTopicSource(scope, topicId)
  if (!source) return null
  const existing = await loadAvoidPrompts(scope, topicId)
  const { questions: accepted, rejected } = readQuestionFile(json, source.text, existing)
  const ids = await insertQuestions(scope, accepted, { topicId, source: 'ai' })
  // The question's origin is stored only in the database for quality comparison (as with generation).
  if (ids.length > 0) await db.update(questions).set({ model: CLAUDE_CODE_MODEL }).where(inArray(questions.id, ids))
  return { created: ids.length, rejected }
}
