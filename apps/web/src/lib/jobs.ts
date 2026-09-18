import 'server-only'
import { and, asc, count, eq, inArray, or, sql } from 'drizzle-orm'
import { db, generationJobs, grades, subjects, topics } from '@/db'

/**
 * Fronta generování pro přehled. Obrazovka i ukazatel v liště čtou totéž:
 * co běží, co čeká, co je hotové a co se nepovedlo. Tabulka `generation_jobs`
 * to všechno ví — jen se to dosud nikde neukazovalo a učitelka neměla jak
 * poznat, že se něco zaseklo.
 */

export type JobState = 'queued' | 'running' | 'done' | 'error'

export interface QueueCounts {
  queued: number
  running: number
  done: number
  error: number
}

export interface QueueJob {
  id: string
  topicId: string
  topicName: string
  /** Předmět a ročník, aby šlo poznat, o které téma z knihovny jde. */
  place: string
  status: JobState
  /** Kolik otázek zadání chtělo — u čekajících je to jediné, co se dá říct. */
  wanted: number | null
  createdCount: number
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

/** Kolik hotových úloh se vypisuje. Starší už nikoho nezajímají. */
export const DONE_LIMIT = 20

/** Počty podle stavu — levný dotaz pro ukazatel v liště. */
export async function countJobs(): Promise<QueueCounts> {
  const rows = await db
    .select({ status: generationJobs.status, value: count() })
    .from(generationJobs)
    .groupBy(generationJobs.status)

  const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.value]))
  return {
    queued: byStatus.queued ?? 0,
    running: byStatus.running ?? 0,
    done: byStatus.done ?? 0,
    error: byStatus.error ?? 0,
  }
}

/**
 * Úlohy pro přehled: všechno nedokončené a k tomu posledních pár hotových.
 * Řadí se tak, jak se to čte — co běží, co čeká, co spadlo, co je hotové.
 */
export async function loadJobs(): Promise<QueueJob[]> {
  const rows = await db
    .select({
      id: generationJobs.id,
      topicId: generationJobs.topicId,
      topicName: topics.name,
      gradeName: grades.name,
      subjectName: subjects.name,
      status: generationJobs.status,
      params: generationJobs.params,
      producedCount: generationJobs.producedCount,
      error: generationJobs.error,
      createdAt: generationJobs.createdAt,
      startedAt: generationJobs.startedAt,
      finishedAt: generationJobs.finishedAt,
    })
    .from(generationJobs)
    .innerJoin(topics, eq(topics.id, generationJobs.topicId))
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    .innerJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(
      or(
        inArray(generationJobs.status, ['queued', 'running', 'error']),
        // Hotové jen posledních pár: po hromadném generování jich jsou stovky
        // a přehled by z nich byl nekonečný výpis.
        sql`${generationJobs.id} in (
          select id from ${generationJobs}
          where status = 'done'
          order by coalesce(finished_at, created_at) desc
          limit ${DONE_LIMIT}
        )`,
      ),
    )
    .orderBy(
      // Pořadí stavů: běžící, čekající, spadlé, hotové.
      sql`case ${generationJobs.status} when 'running' then 0 when 'queued' then 1 when 'error' then 2 else 3 end`,
      asc(generationJobs.createdAt),
    )

  return rows.map((row) => ({
    id: row.id,
    topicId: row.topicId,
    topicName: row.topicName,
    place: [row.subjectName, row.gradeName].filter(Boolean).join(' · '),
    status: row.status,
    wanted: typeof row.params?.count === 'number' ? row.params.count : null,
    createdCount: row.producedCount,
    error: row.error,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  }))
}

/**
 * Vrátí nedokončené úlohy zpátky mezi čekající. Bez toho by po vyčerpaném
 * limitu modelu zbývalo jediné: zařadit celý rozsah znovu a generovat i to,
 * co už hotové je.
 */
export async function retryFailedJobs(ids?: string[]): Promise<number> {
  const target = and(
    eq(generationJobs.status, 'error'),
    ids?.length ? inArray(generationJobs.id, ids) : undefined,
  )

  const failed = await db
    .select({ id: generationJobs.id, topicId: generationJobs.topicId })
    .from(generationJobs)
    .where(target)
  if (failed.length === 0) return 0

  // Téma, které mezitím znovu běží nebo čeká, se nezařazuje podruhé — dvě
  // generování nad týmž tématem o sobě nevědí a vyrobila by tytéž otázky.
  const busy = await db
    .select({ topicId: generationJobs.topicId })
    .from(generationJobs)
    .where(
      and(
        inArray(generationJobs.topicId, failed.map((row) => row.topicId)),
        inArray(generationJobs.status, ['queued', 'running']),
      ),
    )
  const blocked = new Set(busy.map((row) => row.topicId))
  const toRetry = failed.filter((row) => !blocked.has(row.topicId)).map((row) => row.id)
  if (toRetry.length === 0) return 0

  await db
    .update(generationJobs)
    .set({ status: 'queued', error: null, startedAt: null, finishedAt: null, producedCount: 0 })
    .where(inArray(generationJobs.id, toRetry))
  return toRetry.length
}

/**
 * Vyprázdní frontu.
 *
 * `cekajici` (výchozí) zahodí i běžící úlohy: po přerušeném běhu zůstávají
 * viset a jejich téma by šlo odblokovat jedině zásahem do databáze.
 * `vse` k tomu smaže i výpis hotových, když si ho učitelka chce uklidit.
 */
export async function clearJobs(scope: 'cekajici' | 'vse' = 'cekajici'): Promise<number> {
  const removed = await db
    .delete(generationJobs)
    .where(scope === 'vse' ? undefined : inArray(generationJobs.status, ['queued', 'error', 'running']))
    .returning({ id: generationJobs.id })
  return removed.length
}
