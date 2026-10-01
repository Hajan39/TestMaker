import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { AI_NOT_CONFIGURED_MESSAGE, describeAiError, isAiConfigured } from '@testmaker/core/ai'
import { db, questions } from '@/db'
import { createVariant, isTopicBusy, topicBusyMessage, variantDifficultyLimitMessage } from '@/lib/generation'
import { skola, sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'
export const maxDuration = 120

const bodySchema = z.object({
  id: z.string().min(1),
  direction: z.enum(['easier', 'harder']),
})

/**
 * Vytvoří lehčí nebo těžší verzi otázky na stejnou látku. Původní otázka
 * zůstává v bance beze změny — verze je nová otázka navíc, ne náhrada.
 */
export async function POST(request: Request) {
  return sRozsahem(async (ucet) => {
    if (!isAiConfigured()) {
      return Response.json({ error: AI_NOT_CONFIGURED_MESSAGE }, { status: 503 })
    }

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: 'Požadavek nešel zpracovat. Obnov stránku a zkus to znovu.', detail: parsed.error.issues }, { status: 400 })
    }

    const [original] = await db
      .select({ id: questions.id, topicId: questions.topicId, difficulty: questions.difficulty })
      .from(questions)
      .where(and(skola(ucet, questions), eq(questions.id, parsed.data.id)))
      .limit(1)
    if (!original) return Response.json({ error: 'Otázka mezitím zmizela, obnov stránku.' }, { status: 404 })
    if (!original.topicId) {
      return Response.json(
        { error: 'Otázka nepatří k žádnému tématu, nemá se z čeho generovat verze' },
        { status: 409 },
      )
    }

    // Stejná přednost jako u náhrady: dávkové generování tématu má přednost
    // před jednou verzí, aby obě volání nepracovala se stejným seznamem
    // „těmhle otázkám se vyhni".
    const busy = await isTopicBusy(ucet, original.topicId)
    if (busy) {
      return Response.json({ error: topicBusyMessage(busy.kdo) }, { status: 409 })
    }

    // Hranice obtížnosti se hlásí dřív, než se vůbec sáhne na model —
    // učitelka nemá čekat na odpověď modelu na dotaz, který nejde splnit.
    const originalDifficulty = (original.difficulty as 1 | 2 | 3) ?? 2
    const targetDifficulty = originalDifficulty + (parsed.data.direction === 'easier' ? -1 : 1)
    if (targetDifficulty < 1 || targetDifficulty > 3) {
      return Response.json({ error: variantDifficultyLimitMessage(parsed.data.direction) }, { status: 400 })
    }

    try {
      const question = await createVariant(ucet, parsed.data.id, parsed.data.direction, {
        signal: request.signal,
      })
      return Response.json({ question })
    } catch (error) {
      // Hlášky poskytovatele jsou anglicky a technické; překládáme je.
      const { message } = describeAiError(error)
      return Response.json({ error: message }, { status: 502 })
    }
  }, { zapis: true })
}
