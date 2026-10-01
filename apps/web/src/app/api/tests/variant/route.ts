import { z } from 'zod'
import { AI_NOT_CONFIGURED_MESSAGE, describeAiError, isAiConfigured } from '@testmaker/core/ai'
import { createTestVariant } from '@/lib/testVariant'
import { loadTest } from '@/lib/tests'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'
export const maxDuration = 300

const bodySchema = z.object({
  testId: z.string().min(1),
  direction: z.enum(['easier', 'harder']),
})

/**
 * Streamuje vytvoření lehčí nebo těžší verze celé písemky (NDJSON, stejný
 * tvar jako `/api/generate`): `start { total, testId }`, `progress { done, total }`,
 * `done { testId, replaced, generated, kept }`, `error { message }`.
 *
 * `testId` jde už v `start`: při `maxDuration` může platforma funkci ukončit
 * uprostřed průběhu a `done` pak nepřijde nikdy. Klient díky tomu kopii najde
 * a otevře ji s upozorněním, že je hotová jen zčásti — jinak by tiše osiřela.
 *
 * Kopie testu vzniká, až když předběžné kontroly projdou (model je
 * nakonfigurovaný, zdrojový test je vidět) — teprve pak začíná stream, aby se
 * chyba ohlásila obyčejnou odpovědí, ne uprostřed průběhu.
 */
export async function POST(request: Request) {
  return sRozsahem(
    async (ucet) => {
      if (!isAiConfigured()) {
        return Response.json({ error: AI_NOT_CONFIGURED_MESSAGE }, { status: 503 })
      }

      const parsed = bodySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return Response.json(
          { error: 'Verzi písemky se nepodařilo spustit. Obnov stránku a zkus to znovu.', detail: parsed.error.issues },
          { status: 400 },
        )
      }

      const source = await loadTest(ucet, parsed.data.testId)
      if (!source) return Response.json({ error: 'Test se nenašel' }, { status: 404 })

      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        async start(controller) {
          // Zrušený požadavek (učitelka zavřela stránku, prohlížeč odešel
          // jinam) zavře i `controller` — `enqueue`/`close` nad ním pak
          // zahodí, protože není kam psát, ne že by se stream nepovedl.
          const send = (event: Record<string, unknown>) => {
            try {
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
            } catch {
              // Stream je pryč, psát do něj dál nemá smysl.
            }
          }

          try {
            // Záměrně bez `request.signal` (jako u generování listu): odchod ze
            // stránky by verzi utnul uprostřed a zůstala by napůl hotová kopie.
            // Server ji proto dokončí i bez učitelky; uvidí ji v přehledu testů.
            const outcome = await createTestVariant(ucet, parsed.data.testId, parsed.data.direction, {
              onStart: (total, testId) => send({ type: 'start', total, testId }),
              onProgress: (done, total) => send({ type: 'progress', done, total }),
            })
            send({ type: 'done', ...outcome })
          } catch (error) {
            // Hlášky poskytovatele jsou anglicky a technické; překládáme je.
            const { message } = describeAiError(error)
            send({ type: 'error', message })
          } finally {
            try {
              controller.close()
            } catch {
              // Zrušený stream se nedá zavřít podruhé — už zavřený je taky dobře.
            }
          }
        },
      })

      return new Response(stream, {
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
      })
    },
    { zapis: true },
  )
}
