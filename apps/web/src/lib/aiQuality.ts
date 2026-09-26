import 'server-only'
import { and, eq, gte } from 'drizzle-orm'
import type { RegenerateReason } from '@testmaker/core/schema'
import { db, grades, questionFeedback, questions, subjects, topics } from '@/db'
import { skola, type Scope } from './uzivatel'

/** Otázky bez uloženého modelu — starší, z doby před sledováním modelu. */
export const NEZNAMY_MODEL = 'neznámý model'

/** Výchozí okno přehledu: co se dělo naposled, ne celá historie školy. */
const OKNO_DNI = 90

export interface ModelRadek {
  model: string
  generated: number
  regenerated: number
}

export interface DuvodRadek {
  reason: RegenerateReason | null
  count: number
}

export interface PredmetRadek {
  subject: string
  regenerated: number
  topReason: RegenerateReason | null
}

export interface AiQuality {
  models: ModelRadek[]
  reasons: DuvodRadek[]
  bySubject: PredmetRadek[]
}

function vychoziOd(): string {
  return new Date(Date.now() - OKNO_DNI * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Přehled kvality generování pro Správu: kolik otázek který model vygeneroval
 * a kolik jich učitelky nakonec přegenerovaly (i s podílem, i bez důvodu),
 * nejčastější důvody přegenerování a předměty, kde se přegeneruje nejvíc.
 * Výchozí období jsou poslední tři měsíce — starší přegenerování už nikoho
 * nezajímá, model se od nich mohl dávno změnit.
 *
 * Přijaté zjednodušení: `generated` a `regenerated` mají každé své vlastní
 * devadesátidenní okno — první podle `questions.created_at` (kdy otázka
 * vznikla), druhé podle `question_feedback.created_at` (kdy ji učitelka
 * zavrhla). Otázka vygenerovaná před 89 dny a přegenerovaná dnes se tak
 * počítá v obou oknech, ale otázka vygenerovaná před rokem a přegenerovaná
 * dnes už do „vygenerováno“ nespadá — podíl u takového modelu proto může
 * vyjít přes 100 % (víc přegenerování, než kolik je v okně vidět generování).
 * Rozhraní to řeší zobrazením „—“ místo procenta, kdykoli by šlo o dělení
 * nulou nebo o zavádějící číslo nad 100 %; přesné provázání by vyžadovalo
 * dotahovat `questions.created_at` i pro přegenerované otázky, což pro
 * orientační přehled ve Správě nestojí za složitost navíc.
 */
export async function loadAiQuality(scope: Scope, options: { since?: string } = {}): Promise<AiQuality> {
  const since = options.since ?? vychoziOd()

  const generatedRows = await db
    .select({ model: questions.model })
    .from(questions)
    .where(and(skola(scope, questions), eq(questions.source, 'ai'), gte(questions.createdAt, since)))

  const feedbackRows = await db
    .select({ model: questionFeedback.model, reason: questionFeedback.reason })
    .from(questionFeedback)
    .where(and(skola(scope, questionFeedback), gte(questionFeedback.createdAt, since)))

  // Předmět zjistíme jen tam, kde zpětná vazba pořád ukazuje na existující
  // otázku s tématem — jinak by se přegenerování neměl komu přiřadit.
  const subjectRows = await db
    .select({ subject: subjects.name, reason: questionFeedback.reason })
    .from(questionFeedback)
    .innerJoin(questions, eq(questions.id, questionFeedback.questionId))
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(and(skola(scope, questionFeedback), gte(questionFeedback.createdAt, since)))

  const models = new Map<string, ModelRadek>()
  const modelRadek = (model: string): ModelRadek => {
    const existujici = models.get(model)
    if (existujici) return existujici
    const novy: ModelRadek = { model, generated: 0, regenerated: 0 }
    models.set(model, novy)
    return novy
  }
  for (const row of generatedRows) {
    modelRadek(row.model ?? NEZNAMY_MODEL).generated += 1
  }
  for (const row of feedbackRows) {
    modelRadek(row.model ?? NEZNAMY_MODEL).regenerated += 1
  }

  const reasons = new Map<RegenerateReason | null, number>()
  for (const row of feedbackRows) {
    const reason = row.reason ?? null
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
  }

  interface PredmetAgregace {
    regenerated: number
    duvody: Map<RegenerateReason | null, number>
  }
  const subjectMap = new Map<string, PredmetAgregace>()
  for (const row of subjectRows) {
    const agregace = subjectMap.get(row.subject) ?? { regenerated: 0, duvody: new Map() }
    agregace.regenerated += 1
    const reason = row.reason ?? null
    agregace.duvody.set(reason, (agregace.duvody.get(reason) ?? 0) + 1)
    subjectMap.set(row.subject, agregace)
  }

  return {
    models: [...models.values()].sort(
      (a, b) => b.generated - a.generated || b.regenerated - a.regenerated,
    ),
    reasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    bySubject: [...subjectMap.entries()]
      .map(([subject, agregace]) => {
        // Nejčastější důvod v předmětu — při shodě vyhrává ten dřív vidění.
        let topReason: RegenerateReason | null = null
        let max = -1
        for (const [reason, count] of agregace.duvody) {
          if (count > max) {
            max = count
            topReason = reason
          }
        }
        return { subject, regenerated: agregace.regenerated, topReason }
      })
      .sort((a, b) => b.regenerated - a.regenerated),
  }
}
