import { z } from 'zod'
import { db } from '@/db'
import {
  FORMAT,
  VERZE,
  jeTabulka,
  nazevSouboru,
  zalohaKousky,
  zapisOdkazyDuplicit,
  zapisRadky,
} from '@/lib/backup'
import { ROLE_SPRAVY } from '@/lib/role'
import { sRozsahem, zapsatAudit } from '@/lib/uzivatel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Záloha celé knihovny do jednoho souboru JSON.
 *
 * Odpověď odtéká postupně (`ReadableStream`), ne jako jeden hotový řetězec:
 * streamovaná odpověď se nevejde do stropu 4,5 MB na požadavek, protože se
 * do paměti funkce nikdy celá nedostane. Dnešní knihovna dá přes 3 MB
 * a bude přibývat.
 */
export async function GET() {
  return sRozsahem(
    async (ucet) => {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const kousek of zalohaKousky(db, { schoolId: ucet.schoolId })) {
          controller.enqueue(encoder.encode(kousek))
        }
        controller.close()
      } catch (error) {
        // Soubor už se stahuje, takže chybu nejde poslat jako stavový kód —
        // jediné, co jde, je spojení přerušit, aby nevznikl useklý JSON,
        // který by šlo obnovit jako by byl v pořádku.
        controller.error(error)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${nazevSouboru()}"`,
      'cache-control': 'no-store',
    },
  })
    },
    // Záloha je celá škola: patří správci, ne jednotlivé učitelce.
    { role: ROLE_SPRAVY },
  )
}

const davkaSchema = z.union([
  z.object({
    tabulka: z.string(),
    radky: z.array(z.record(z.string(), z.unknown())),
  }),
  z.object({
    tabulka: z.literal('materials'),
    odkazy: z.array(
      z.object({
        id: z.string().min(1),
        duplicateOfId: z.string().min(1),
        duplicateScore: z.number().nullable().default(null),
      }),
    ),
  }),
  // Verze otázky ukazuje na svůj kořen; stejně jako duplicity materiálů se
  // dopisuje, až jsou v cíli všechny otázky.
  z.object({
    tabulka: z.literal('questions'),
    odkazy: z.array(
      z.object({
        id: z.string().min(1),
        variantOf: z.string().min(1),
      }),
    ),
  }),
])

/**
 * Obnova ze zálohy — po dávkách.
 *
 * Na rozdíl od stahování se na nahrávání strop 4,5 MB na požadavek vztahuje,
 * proto soubor krájí prohlížeč (`lib/backupClient.ts`) a posílá sem tabulku
 * po tabulce, po dávkách. Pořadí dávek hlídá klient; tady se jen zapisuje.
 *
 * Slučuje se podle `id` (`on conflict do update`) a nic se nemaže: obnova do
 * neprázdné knihovny je doplnění, ne výměna. Tentýž soubor jde nahrát dvakrát
 * a podruhé se nic nezdvojí.
 */
export async function POST(request: Request) {
  return sRozsahem(
    async (ucet) => {
  const parsed = davkaSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json(
      { error: `Tohle nevypadá jako záloha TestMakeru (${FORMAT}, verze ${VERZE}).` },
      { status: 400 },
    )
  }

  const davka = parsed.data
  if (!jeTabulka(davka.tabulka)) {
    return Response.json({ error: `Neznámá část zálohy: ${davka.tabulka}` }, { status: 400 })
  }

  try {
    if ('odkazy' in davka) {
      const zapsano = await zapisOdkazyDuplicit(db, davka.odkazy, { schoolId: ucet.schoolId })
      await zapsatAudit({
        schoolId: ucet.schoolId,
        userId: ucet.userId,
        action: 'obnova-ze-zalohy',
        entity: davka.tabulka,
        detail: { odkazy: zapsano },
      })
      return Response.json({ ok: true, tabulka: davka.tabulka, zapsano })
    }

    const vysledek = await zapisRadky(db, davka.tabulka, davka.radky, {
      schoolId: ucet.schoolId,
      userId: ucet.userId,
    })
    return Response.json({
      ok: true,
      tabulka: davka.tabulka,
      zapsano: vysledek.zapsano,
      odkazy: vysledek.odkazy,
    })
  } catch (error) {
    // Typicky chybějící nadřazená položka (téma bez předmětu) nebo soubor
    // z novější verze aplikace. Učitelce nepomůže hláška z SQLite, ale to,
    // kde přesně se obnova zadrhla. Vysvětlení z `lib/backup` (stejný název,
    // chybějící nadřazená položka, řádek bez id) projde; cokoli jiného je
    // technický detail a ten jde jen do logu serveru.
    const zprava = error instanceof Error ? error.message : ''
    const vysvetleno = /^(V tabulce|Položka|Řádek tabulky) /.test(zprava) && !/nepodařilo zapsat:/.test(zprava)
    if (!vysvetleno) console.error(`Obnova ze zálohy: tabulka ${davka.tabulka}`, error)
    return Response.json(
      {
        error: vysvetleno
          ? zprava
          : `Část zálohy nejde nahrát (tabulka ${davka.tabulka}). Záloha je nejspíš z jiné verze aplikace nebo poškozená.`,
      },
      { status: 400 },
    )
  }
    },
    { role: ROLE_SPRAVY },
  )
}
