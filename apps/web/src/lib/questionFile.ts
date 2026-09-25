import { inArray } from 'drizzle-orm'
import { buildTopicSourceFile, CLAUDE_CODE_MODEL, readQuestionFile } from '@testmaker/core/ai'
import { db, questions } from '@/db'
import { loadTopicSource } from './generation'
import { insertQuestions, loadAvoidPrompts } from './questions'
import type { Scope } from './uzivatel'

/**
 * Text tématu ke stažení pro Claude Code (`/otazky`). Stejný text, jaký
 * dostává model při generování v aplikaci, s hlavičkou o ročníku
 * a otázkách, které už v tématu jsou. Cizí téma → `null`.
 */
export async function topicSourceFile(scope: Scope, topicId: string): Promise<{ fileName: string; text: string } | null> {
  const source = await loadTopicSource(scope, topicId)
  if (!source) return null
  const existing = await loadAvoidPrompts(scope, topicId)
  return {
    fileName: `${source.topicName}.txt`,
    text: buildTopicSourceFile({
      subjectName: source.subjectName,
      gradeName: source.gradeName || null,
      topicName: source.topicName,
      text: source.text,
      existing,
    }),
  }
}

/**
 * Nahraje otázky ze souboru z Claude Code. Kontrola je tatáž jako při
 * generování (tvar, doslovná citace, duplicity); co neprojde, vrátí se
 * s důvodem. Cizí téma → `null`.
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
  const ids = await insertQuestions(scope, accepted, { topicId, source: 'ai', status: 'draft' })
  // Odkud otázka je, se ukládá jen do databáze pro srovnání kvality (jako u generování).
  if (ids.length > 0) await db.update(questions).set({ model: CLAUDE_CODE_MODEL }).where(inArray(questions.id, ids))
  return { created: ids.length, rejected }
}
