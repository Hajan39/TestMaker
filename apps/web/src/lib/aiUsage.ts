import 'server-only'
import { count, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { listAiModels, type AiCallEvent, type AiCallListener } from '@testmaker/core/ai'
import { aiCalls, db, schools, type AiCallRow } from '@/db'
import { newId } from '@/lib/ids'
import { roleJeAdministrator } from '@/lib/role'
import type { Scope } from '@/lib/uzivatel'

/**
 * Použití AI: každý pokus o volání modelu se zapíše do `ai_calls` a
 * administrátor z toho vidí provoz — který model se opravdu volá, kolik
 * tokenů spotřeboval a jak často narazil na limit. Nic se tu nenastavuje;
 * žebříček modelů určuje dál jen `AI_MODELS`.
 */

export type UlohaAi = AiCallRow['task']

/** Úlohy v pořadí, jak je ukazuje přehled. */
export const ULOHY_AI: readonly UlohaAi[] = ['otazky', 'hlavolam', 'list']

/** Kdo generování spustil. U fronty a plánovače nikdo přihlášený není (`userId: null`). */
export interface Volajici {
  schoolId: string
  userId: string | null
}

export const OBDOBI_DNI = [7, 30, 90] as const
export type ObdobiDni = (typeof OBDOBI_DNI)[number]
const VYCHOZI_OBDOBI: ObdobiDni = 30

/** Období z adresy (`?dni=`); cokoli jiného než 7, 30 nebo 90 znamená výchozích 30. */
export function obdobiZ(value: unknown): ObdobiDni {
  const dni = Number(value)
  return (OBDOBI_DNI as readonly number[]).includes(dni) ? (dni as ObdobiDni) : VYCHOZI_OBDOBI
}

const DEN_MS = 24 * 60 * 60 * 1000
/** Jak dlouho se záznamy drží — přes rok, ať jde porovnat stejné období loni. */
const UCHOVAT_DNI = 400
/** Úklid starých záznamů zhruba jednou za tolik zápisů. */
const UKLID_JEDNOU_ZA = 500

/**
 * Zapíše jeden pokus o volání. Nikdy nevyhodí výjimku: záznam o provozu
 * nesmí shodit generování, které popisuje.
 */
export async function zapsatVolani(kdo: Volajici, task: UlohaAi, event: AiCallEvent): Promise<void> {
  try {
    await db.insert(aiCalls).values({
      id: newId(),
      schoolId: kdo.schoolId,
      userId: kdo.userId,
      task,
      model: event.model,
      outcome: event.outcome,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      durationMs: Math.round(event.durationMs),
    })
    // ponytail: úklid při zápisu (náhodně jednou za ~500 zápisů); cron, až to bude potřeba.
    if (Math.random() < 1 / UKLID_JEDNOU_ZA) await uklidStarychVolani()
  } catch (error) {
    console.error('Záznam o volání modelu se nepodařilo uložit:', error)
  }
}

/**
 * Posluchač pro `startLadder` (přes `onCall` v generátorech z core). Zápis
 * běží na pozadí — generování na databázi nečeká.
 */
export function zapisovatVolani(kdo: Volajici, task: UlohaAi): AiCallListener {
  const volajici: Volajici = { schoolId: kdo.schoolId, userId: kdo.userId }
  return (event) => {
    void zapsatVolani(volajici, task, event)
  }
}

/** Smaže záznamy starší než 400 dní; vrací, kolik jich bylo. */
export async function uklidStarychVolani(now: number = Date.now()): Promise<number> {
  const hranice = new Date(now - UCHOVAT_DNI * DEN_MS).toISOString()
  const smazane = await db.delete(aiCalls).where(lt(aiCalls.createdAt, hranice)).returning({ id: aiCalls.id })
  return smazane.length
}

export interface ModelPouziti {
  model: string
  volani: number
  ok: number
  limit: number
  badShape: number
  error: number
  vstup: number
  vystup: number
  /** Čas posledního volání (ISO). */
  naposledy: string
}

export interface UlohaPouziti {
  task: UlohaAi
  volani: number
  vstup: number
  vystup: number
}

export interface SkolaPouziti {
  schoolId: string
  nazev: string
  volani: number
  vstup: number
  vystup: number
}

export interface DenPouziti {
  /** `YYYY-MM-DD` v UTC, stejně jako `created_at`. */
  den: string
  ok: number
  limit: number
  /** Nepoužitelná odpověď a chyby. */
  ostatni: number
}

export interface PrehledPouzitiAi {
  dni: ObdobiDni
  celkem: number
  /** Žebříček, jak je teď nastavený, i s modely bez klíče. */
  zebricek: { model: string; maKlic: boolean }[]
  modely: ModelPouziti[]
  /** Vždy všechny tři úlohy v pevném pořadí. */
  ulohy: UlohaPouziti[]
  skoly: SkolaPouziti[]
  /** Přesně `dni` dní, od nejstaršího po dnešek, i ty bez volání. */
  dny: DenPouziti[]
}

const pocet = (outcome: AiCallRow['outcome']) =>
  sql<number>`coalesce(sum(case when ${aiCalls.outcome} = ${outcome} then 1 else 0 end), 0)`.mapWith(Number)
const vstup = () => sql<number>`coalesce(sum(${aiCalls.inputTokens}), 0)`.mapWith(Number)
const vystup = () => sql<number>`coalesce(sum(${aiCalls.outputTokens}), 0)`.mapWith(Number)

/**
 * Přehled použití AI za posledních `dni` dní (včetně dneška) pro
 * administraci. Jiná role než administrátor dostane `null` — stránka i API
 * se pak tváří jako neexistující.
 *
 * Vědomá výjimka z pravidla „jeden dotaz, jedna škola“: administrátor tu
 * vidí napříč školami. Dotaz vrací jen agregáty (počty a tokeny), žádný obsah.
 */
export async function prehledPouzitiAi(
  scope: Scope,
  dni: ObdobiDni,
  options: { now?: number } = {},
): Promise<PrehledPouzitiAi | null> {
  if (!roleJeAdministrator(scope.role)) return null
  const now = options.now ?? Date.now()

  const dnyObdobi = Array.from({ length: dni }, (_, i) =>
    new Date(now - (dni - 1 - i) * DEN_MS).toISOString().slice(0, 10),
  )
  const vObdobi = gte(aiCalls.createdAt, `${dnyObdobi[0]}T00:00:00.000Z`)
  const den = sql<string>`substr(${aiCalls.createdAt}, 1, 10)`

  const [modely, ulohy, skoly, dny] = await Promise.all([
    db
      .select({
        model: aiCalls.model,
        volani: count(),
        ok: pocet('ok'),
        limit: pocet('limit'),
        badShape: pocet('bad_shape'),
        error: pocet('error'),
        vstup: vstup(),
        vystup: vystup(),
        naposledy: sql<string>`max(${aiCalls.createdAt})`,
      })
      .from(aiCalls)
      .where(vObdobi)
      .groupBy(aiCalls.model)
      .orderBy(desc(count()), aiCalls.model),
    db
      .select({ task: aiCalls.task, volani: count(), vstup: vstup(), vystup: vystup() })
      .from(aiCalls)
      .where(vObdobi)
      .groupBy(aiCalls.task),
    db
      .select({ schoolId: aiCalls.schoolId, nazev: schools.name, volani: count(), vstup: vstup(), vystup: vystup() })
      .from(aiCalls)
      .innerJoin(schools, eq(schools.id, aiCalls.schoolId))
      .where(vObdobi)
      .groupBy(aiCalls.schoolId)
      .orderBy(desc(count()), schools.name),
    db
      .select({ den, volani: count(), ok: pocet('ok'), limit: pocet('limit') })
      .from(aiCalls)
      .where(vObdobi)
      .groupBy(den),
  ])

  const podleDne = new Map(dny.map((radek) => [radek.den, radek]))
  const podleUlohy = new Map(ulohy.map((radek) => [radek.task, radek]))

  return {
    dni,
    celkem: modely.reduce((soucet, radek) => soucet + radek.volani, 0),
    zebricek: listAiModels().map(({ model, hasKey }) => ({ model, maKlic: hasKey })),
    modely,
    ulohy: ULOHY_AI.map((task) => {
      const radek = podleUlohy.get(task)
      return { task, volani: radek?.volani ?? 0, vstup: radek?.vstup ?? 0, vystup: radek?.vystup ?? 0 }
    }),
    skoly,
    dny: dnyObdobi.map((datum) => {
      const radek = podleDne.get(datum)
      if (!radek) return { den: datum, ok: 0, limit: 0, ostatni: 0 }
      return { den: datum, ok: radek.ok, limit: radek.limit, ostatni: radek.volani - radek.ok - radek.limit }
    }),
  }
}
