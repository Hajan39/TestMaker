import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { describeAiError, isAiConfigured } from '@testmaker/core/ai'
import { db, questions } from '@/db'
import { isTopicBusy, regenerateQuestion, topicBusyMessage } from '@/lib/generation'
import { skola, sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'
export const maxDuration = 120

const bodySchema = z.object({ id: z.string().min(1) })

/**
 * Je náhrada modelem vůbec k dispozici? Rozhraní podle toho tlačítko skryje,
 * místo aby ho nabídlo a pak spadlo na chybějícím klíči.
 */
export function GET() {
  return Response.json({ configured: isAiConfigured() })
}

/**
 * Náhrada jedné otázky modelem: vygeneruje se nová otázka téhož typu a
 * obtížnosti ze stejných materiálů a teprve pak se původní označí jako
 * zamítnutá. Když model selže, nezmění se v databázi nic a vrátí se česká
 * hláška — pro učitelku to znamená, že se prostě nic nestalo a může to
 * zkusit znovu.
 */
export async function POST(request: Request) {
  return sRozsahem(async (ucet) => {
  if (!isAiConfigured()) {
    return Response.json(
      {
        error:
          'AI není nakonfigurovaná — doplň ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN nebo GOOGLE_GENERATIVE_AI_API_KEY',
      },
      { status: 503 },
    )
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return Response.json({ error: 'Neplatná data', detail: parsed.error.issues }, { status: 400 })
  }

  const [original] = await db
    .select({ id: questions.id, topicId: questions.topicId })
    .from(questions)
    .where(and(skola(ucet, questions), eq(questions.id, parsed.data.id)))
    .limit(1)
  if (!original) return Response.json({ error: 'Otázka nenalezena' }, { status: 404 })
  if (!original.topicId) {
    return Response.json(
      { error: 'Otázka nepatří k žádnému tématu, nemá se z čeho generovat náhrada' },
      { status: 409 },
    )
  }

  // Téma se nerezervuje (`claimTopic`) — kvůli jedné otázce by dávka zablokovala
  // celé téma. Běžící dávkové generování ale přednost má, protože obě volání by
  // jinak pracovala se stejným seznamem „těmhle otázkám se vyhni".
  const busy = await isTopicBusy(ucet, original.topicId)
  if (busy) {
    return Response.json({ error: topicBusyMessage(busy.kdo) }, { status: 409 })
  }

  try {
    const question = await regenerateQuestion(ucet, parsed.data.id, { signal: request.signal })
    return Response.json({ question })
  } catch (error) {
    // Hlášky poskytovatele jsou anglicky a technické; překládáme je.
    const { message } = describeAiError(error)
    return Response.json({ error: message }, { status: 502 })
  }
  }, { zapis: true })
}
