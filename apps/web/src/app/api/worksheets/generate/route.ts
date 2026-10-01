import { z } from 'zod'
import { AI_NOT_CONFIGURED_MESSAGE, AI_SETTINGS, describeAiError, isAiConfigured } from '@testmaker/core/ai'
import { createGeneratedWorksheet, WORKSHEET_TOPIC_GONE_MESSAGE } from '@/lib/tests'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'
export const maxDuration = 120

const S = AI_SETTINGS.worksheet

const brief = {
  /** Přání učitelky („víc tabulek, na 20 minut“). */
  instructions: z.string().max(S.instructionsMax).default(''),
  /** Vlastní text vložený do zadání — jen text, soubory se na server neposílají. */
  ownText: z.string().max(S.ownTextMax).default(''),
}

const bodySchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('topic'), topicId: z.string().min(1), ...brief }),
  z.object({
    source: z.literal('free'),
    title: z.string().trim().min(1).max(200),
    gradeId: z.string().min(1).nullable().default(null),
    ...brief,
  }),
])

/**
 * Vygeneruje pracovní list jedním voláním modelu a uloží ho i s položkami.
 * Vrací id listu a kolik položek model nevrátil v pořádku.
 */
export async function POST(request: Request) {
  return sRozsahem(
    async (ucet) => {
      if (!isAiConfigured()) {
        return Response.json(
          { error: `${AI_NOT_CONFIGURED_MESSAGE} Můžeš ale založit prázdný list a vyplnit ho ručně.` },
          { status: 503 },
        )
      }
      const parsed = bodySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return Response.json(
          {
            error:
              'Zadání listu není úplné — vyber téma, nebo napiš, o čem má list být (nejvýš 200 znaků), a zkus to znovu.',
            detail: parsed.error.issues,
          },
          { status: 400 },
        )
      }
      const body = parsed.data
      const source = body.source === 'topic' ? { topicId: body.topicId } : { title: body.title, gradeId: body.gradeId }

      try {
        // Záměrně bez `request.signal`: když učitelka zavře stránku, list se
        // stejně dogeneruje a uloží a najde ho v přehledu listů.
        const result = await createGeneratedWorksheet(ucet, {
          source,
          instructions: body.instructions.trim(),
          ownText: body.ownText.trim(),
        })
        if (!result) return Response.json({ error: WORKSHEET_TOPIC_GONE_MESSAGE }, { status: 404 })
        return Response.json(result)
      } catch (error) {
        // Surové znění chyby zůstane v logu serveru; učitelka dostane českou radu.
        console.error('Pracovní list se nepodařilo vygenerovat:', error)
        return Response.json({ error: describeAiError(error).message }, { status: 502 })
      }
    },
    { zapis: true },
  )
}
