/**
 * Moves old questions to "Smazané" in bulk — like the Smazat button in a
 * topic, just for all questions created before the chosen day at once.
 *
 *   pnpm --filter @testmaker/web otazky:smazat -- --pred 2026-09-25            # only counts
 *   pnpm --filter @testmaker/web otazky:smazat -- --pred 2026-09-25 --zapsat   # really deletes
 *
 * Without `--zapsat` nothing changes; it only prints how many questions, and
 * in which topics, it would delete. Deletion only moves to Smazané
 * (`status = 'rejected'`), not permanently: questions can be restored in the
 * topic via the "Smazané" filter, and tests that used them don't change (they
 * print from frozen snapshots).
 *
 * By default only what the model generated (`source = 'ai'`, which includes
 * questions uploaded as a file from `/otazky`); hand-written questions stay
 * unless `--i-rucni` is added. The day is in local time: `--pred 2026-09-25`
 * means "created before midnight between 24 and 25 September".
 */
import { loadEnv } from './env'

loadEnv()

async function main(): Promise<void> {
  const { db, questions, topics, grades, subjects } = await import('../src/db')
  const { and, eq, inArray, lt, sql } = await import('drizzle-orm')

  /** Value of a `--name value` flag. */
  function flag(name: string): string | null {
    const index = process.argv.indexOf(`--${name}`)
    return index >= 0 ? (process.argv[index + 1] ?? null) : null
  }

  const before = flag('pred')
  const write = process.argv.includes('--zapsat')
  const includeManual = process.argv.includes('--i-rucni')

  if (!before || !/^\d{4}-\d{2}-\d{2}$/.test(before)) {
    console.error('Použití: otazky:smazat -- --pred RRRR-MM-DD [--i-rucni] [--zapsat]')
    process.exit(1)
  }
  const cutoffDate = new Date(`${before}T00:00:00`)
  if (Number.isNaN(cutoffDate.getTime())) {
    console.error(`Neplatné datum: ${before}`)
    process.exit(1)
  }

  console.log(`Databáze: ${process.env.DATABASE_URL || 'file:./local.db'}`)
  console.log(
    `Otázky vytvořené před ${cutoffDate.toLocaleString('cs-CZ')}` +
      (includeManual ? ' (AI i ručně psané)' : ' (jen z AI, ručně psané zůstanou)'),
  )

  const condition = and(
    lt(questions.createdAt, cutoffDate.toISOString()),
    inArray(questions.status, ['draft', 'approved']),
    includeManual ? undefined : eq(questions.source, 'ai'),
  )

  const byTopic = await db
    .select({
      subject: subjects.name,
      grade: grades.name,
      topic: topics.name,
      count: sql<number>`count(*)`,
    })
    .from(questions)
    .leftJoin(topics, eq(topics.id, questions.topicId))
    .leftJoin(grades, eq(grades.id, topics.gradeId))
    .leftJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(condition)
    .groupBy(subjects.name, grades.name, topics.name)
    .orderBy(subjects.name, grades.name, topics.name)

  const total = byTopic.reduce((sum, row) => sum + Number(row.count), 0)
  for (const row of byTopic) {
    const where = row.topic ? `${row.subject ?? '?'} · ${row.grade ?? '?'} · ${row.topic}` : '(bez tématu)'
    console.log(`  ${String(row.count).padStart(4)}  ${where}`)
  }
  console.log(`Celkem: ${total}`)

  if (total === 0) process.exit(0)
  if (!write) {
    console.log('\nNic se nezměnilo. Pro smazání spusť znovu s --zapsat.')
    process.exit(0)
  }

  const now = new Date().toISOString()
  const result = await db.update(questions).set({ status: 'rejected', reviewedAt: now }).where(condition)
  console.log(`\nPřesunuto do Smazaných: ${result.rowsAffected}. Obnovit jdou v tématu filtrem „Smazané".`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
