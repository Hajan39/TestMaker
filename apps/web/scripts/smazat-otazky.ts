/**
 * Hromadně přesune staré otázky do „Smazaných" — stejně jako tlačítko Smazat
 * v tématu, jen pro všechny otázky vytvořené před zvoleným dnem naráz.
 *
 *   pnpm --filter @testmaker/web otazky:smazat -- --pred 2026-09-25            # jen spočítá
 *   pnpm --filter @testmaker/web otazky:smazat -- --pred 2026-09-25 --zapsat   # opravdu smaže
 *
 * Bez `--zapsat` nic nemění, jen vypíše, kolik otázek a ve kterých tématech by
 * smazal. Maže se jen do Smazaných (`status = 'rejected'`), ne natrvalo:
 * otázky jdou v tématu obnovit filtrem „Smazané" a písemky, ve kterých byly,
 * se nezmění (tisknou se ze zmrazených snímků).
 *
 * Výchozí je jen to, co vygeneroval model (`source = 'ai'`, sem patří i otázky
 * nahrané souborem z `/otazky`); ručně psané otázky zůstanou, dokud se nepřidá
 * `--i-rucni`. Den se bere v místním čase: `--pred 2026-09-25` znamená
 * „vytvořené před půlnocí z 24. na 25. září".
 */
import { loadEnv } from './env'

loadEnv()

async function main(): Promise<void> {
  const { db, questions, topics, grades, subjects } = await import('../src/db')
  const { and, eq, inArray, lt, sql } = await import('drizzle-orm')

  /** Hodnota přepínače `--jmeno hodnota`. */
  function prepinac(jmeno: string): string | null {
    const index = process.argv.indexOf(`--${jmeno}`)
    return index >= 0 ? (process.argv[index + 1] ?? null) : null
  }

  const pred = prepinac('pred')
  const zapsat = process.argv.includes('--zapsat')
  const iRucni = process.argv.includes('--i-rucni')

  if (!pred || !/^\d{4}-\d{2}-\d{2}$/.test(pred)) {
    console.error('Použití: otazky:smazat -- --pred RRRR-MM-DD [--i-rucni] [--zapsat]')
    process.exit(1)
  }
  const hranice = new Date(`${pred}T00:00:00`)
  if (Number.isNaN(hranice.getTime())) {
    console.error(`Neplatné datum: ${pred}`)
    process.exit(1)
  }

  console.log(`Databáze: ${process.env.DATABASE_URL || 'file:./local.db'}`)
  console.log(
    `Otázky vytvořené před ${hranice.toLocaleString('cs-CZ')}` +
      (iRucni ? ' (AI i ručně psané)' : ' (jen z AI, ručně psané zůstanou)'),
  )

  const podminka = and(
    lt(questions.createdAt, hranice.toISOString()),
    inArray(questions.status, ['draft', 'approved']),
    iRucni ? undefined : eq(questions.source, 'ai'),
  )

  const podleTemat = await db
    .select({
      predmet: subjects.name,
      rocnik: grades.name,
      tema: topics.name,
      pocet: sql<number>`count(*)`,
    })
    .from(questions)
    .leftJoin(topics, eq(topics.id, questions.topicId))
    .leftJoin(grades, eq(grades.id, topics.gradeId))
    .leftJoin(subjects, eq(subjects.id, grades.subjectId))
    .where(podminka)
    .groupBy(subjects.name, grades.name, topics.name)
    .orderBy(subjects.name, grades.name, topics.name)

  const celkem = podleTemat.reduce((soucet, radek) => soucet + Number(radek.pocet), 0)
  for (const radek of podleTemat) {
    const kde = radek.tema ? `${radek.predmet ?? '?'} · ${radek.rocnik ?? '?'} · ${radek.tema}` : '(bez tématu)'
    console.log(`  ${String(radek.pocet).padStart(4)}  ${kde}`)
  }
  console.log(`Celkem: ${celkem}`)

  if (celkem === 0) process.exit(0)
  if (!zapsat) {
    console.log('\nNic se nezměnilo. Pro smazání spusť znovu s --zapsat.')
    process.exit(0)
  }

  const ted = new Date().toISOString()
  const vysledek = await db.update(questions).set({ status: 'rejected', reviewedAt: ted }).where(podminka)
  console.log(`\nPřesunuto do Smazaných: ${vysledek.rowsAffected}. Obnovit jdou v tématu filtrem „Smazané".`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
