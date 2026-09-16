/**
 * Hromadné generování otázek z příkazové řádky.
 *
 * Fronta v aplikaci potřebuje otevřené okno; přes tenhle skript jde nechat
 * projet celý ročník nebo celou knihovnu na pozadí, třeba přes noc. Jede po
 * jednom tématu, aby se běhy nemíchaly a model dostal u každého tématu
 * seznam už existujících otázek, kterým se má vyhnout.
 *
 * Příklady:
 *   pnpm --filter @testmaker/web generate:bulk -- --grade <id> --count 10
 *   pnpm --filter @testmaker/web generate:bulk -- --subject <id> --target 12
 *   pnpm --filter @testmaker/web generate:bulk -- --all --target 10 --model gemini-flash-lite-latest
 *
 * `--count` vytvoří tolik nových otázek, `--target` doplní téma na tenhle
 * celkový počet. Bez `--force` se přeskakují témata, která už otázky mají
 * (u `--target` se přeskočí jen ta, kde je počet naplněný).
 */
import { existsSync, readFileSync } from 'node:fs'

interface Options {
  gradeId?: string
  subjectId?: string
  all: boolean
  count: number
  mode: 'add' | 'target'
  model?: string
  force: boolean
}

function parseArgs(argv: string[]): Options {
  const options: Options = { all: false, count: 10, mode: 'add', force: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--grade') options.gradeId = next
    else if (arg === '--subject') options.subjectId = next
    else if (arg === '--all') options.all = true
    else if (arg === '--count') options.count = Number(next)
    else if (arg === '--target') {
      options.count = Number(next)
      options.mode = 'target'
    } else if (arg === '--model') options.model = next
    else if (arg === '--force') options.force = true
  }
  return options
}

/** `.env.local` čte jen Next.js; skript spouštěný přes tsx si ho musí načíst sám. */
function loadEnv(): void {
  if (!existsSync('.env.local')) return
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match && match[1] && match[2] && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim()
    }
  }
}

async function main(): Promise<void> {
  loadEnv()
  const options = parseArgs(process.argv.slice(2))
  if (options.model) process.env.AI_MODEL = options.model
  if (!options.gradeId && !options.subjectId && !options.all) {
    console.error('Chybí rozsah: --grade <id>, --subject <id>, nebo --all.')
    process.exit(1)
  }
  if (!Number.isFinite(options.count) || options.count < 1) {
    console.error('Počet otázek musí být kladné číslo (--count nebo --target).')
    process.exit(1)
  }

  const { db, grades, questions, topics } = await import('../src/db/index')
  const { and, eq, ne, sql } = await import('drizzle-orm')
  const { DEFAULT_GENERATE_PARAMS, generateForTopic, resolveCount } = await import('../src/lib/generation')
  const { isAiConfigured, readAiConfig } = await import('@testmaker/core/ai')

  if (!isAiConfigured()) {
    console.error('Chybí klíč k modelu — doplň ho do apps/web/.env.local.')
    process.exit(1)
  }

  const scope = options.gradeId
    ? eq(topics.gradeId, options.gradeId)
    : options.subjectId
      ? sql`${topics.gradeId} in (select id from grades where subject_id = ${options.subjectId})`
      : sql`1 = 1`

  const rows = await db
    .select({ id: topics.id, name: topics.name, grade: grades.name })
    .from(topics)
    .innerJoin(grades, eq(grades.id, topics.gradeId))
    // Téma bez použitelného textu by jen spadlo na chybu.
    .where(and(scope, eq(topics.lowContent, false)))
    .orderBy(topics.name)

  const config = readAiConfig()
  console.log(`poskytovatel ${config.provider}, model ${config.model}`)
  console.log(`témat v rozsahu: ${rows.length}`)

  let created = 0
  let failed = 0
  for (const [index, topic] of rows.entries()) {
    const label = `${index + 1}/${rows.length} ${topic.grade ? `${topic.grade} · ` : ''}${topic.name}`

    const wanted = await resolveCount(topic.id, { ...DEFAULT_GENERATE_PARAMS, count: options.count, mode: options.mode })
    if (options.mode === 'target' && wanted === 0) {
      console.log(`${label}: přeskočeno, počet je naplněný`)
      continue
    }
    if (options.mode === 'add' && !options.force) {
      const [existing] = await db
        .select({ value: sql<number>`count(*)` })
        .from(questions)
        .where(and(eq(questions.topicId, topic.id), ne(questions.status, 'rejected')))
      if (Number(existing?.value ?? 0) > 0) {
        console.log(`${label}: přeskočeno, otázky už má (--force je vygeneruje i tak)`)
        continue
      }
    }

    const started = Date.now()
    try {
      const outcome = await generateForTopic(topic.id, {
        ...DEFAULT_GENERATE_PARAMS,
        count: options.count,
        mode: options.mode,
      })
      created += outcome.created
      console.log(
        `${label}: ${outcome.created} otázek za ${Math.round((Date.now() - started) / 1000)} s` +
          (outcome.rejected > 0 ? `, ${outcome.rejected} zahozeno` : '') +
          (outcome.failedCalls > 0 ? `, ${outcome.failedCalls}× model neodpověděl použitelně` : ''),
      )
    } catch (error) {
      failed += 1
      const { describeAiError } = await import('@testmaker/core/ai')
      console.log(`${label}: ${describeAiError(error).message}`)
    }
  }

  console.log(`hotovo: ${created} nových otázek, ${failed} témat skončilo chybou`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
