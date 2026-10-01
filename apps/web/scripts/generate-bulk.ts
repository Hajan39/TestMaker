/**
 * Bulk question generation from the command line.
 *
 * The in-app queue needs an open window; this script can run a whole grade or
 * the whole library in the background, e.g. overnight.
 *
 * Examples:
 *   pnpm --filter @testmaker/web generate:bulk -- --grade <id> --count 10
 *   pnpm --filter @testmaker/web generate:bulk -- --subject <id> --target 12
 *   pnpm --filter @testmaker/web generate:bulk -- --all --models google:gemini-flash-latest,google:gemini-flash-lite-latest
 *
 * `--count` creates that many new questions, `--target` tops the topic up to
 * that total. Without `--force` topics that already have questions are skipped
 * (with `--target` only those whose count is already reached).
 *
 * `--models` is the ladder (same as the `AI_MODELS` variable): when the first
 * model hits its daily quota, the run continues with the next one instead of
 * failing the whole grade. A paid model enters the ladder only if you write it there.
 *
 * `--ucet <e-mail>` says on whose behalf to generate: questions get that
 * account's school and author. Without it the first admin in the database is
 * used — on a single-school install that's the person running the script.
 */
import { loadEnv } from './env'

interface Options {
  gradeId?: string
  subjectId?: string
  all: boolean
  count: number
  mode: 'add' | 'target'
  models?: string
  force: boolean
  /** E-mail of the account to generate for. */
  account?: string
}

function parseArgs(argv: string[]): Options {
  const options: Options = { all: false, count: 10, mode: 'add', force: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--ucet') options.account = next
    else if (arg === '--grade') options.gradeId = next
    else if (arg === '--subject') options.subjectId = next
    else if (arg === '--all') options.all = true
    else if (arg === '--count') options.count = Number(next)
    else if (arg === '--target') {
      options.count = Number(next)
      options.mode = 'target'
    } else if (arg === '--models') options.models = next
    else if (arg === '--force') options.force = true
  }
  return options
}

async function main(): Promise<void> {
  loadEnv()
  const options = parseArgs(process.argv.slice(2))
  if (options.models) process.env.AI_MODELS = options.models
  if (!options.gradeId && !options.subjectId && !options.all) {
    console.error('Chybí rozsah: --grade <id>, --subject <id>, nebo --all.')
    process.exit(1)
  }
  if (!Number.isFinite(options.count) || options.count < 1) {
    console.error('Počet otázek musí být kladné číslo (--count nebo --target).')
    process.exit(1)
  }

  const { db, grades, questions, topics, users } = await import('../src/db/index')
  const { and, eq, ne, sql } = await import('drizzle-orm')
  const { DEFAULT_GENERATE_PARAMS, generateForTopic, resolveCount } = await import('../src/lib/generation')
  const { describeAiConfig, isAiConfigured, readAiLadder } = await import('@testmaker/core/ai')
  const { asc } = await import('drizzle-orm')

  // On whose behalf to generate. Without an identity questions would have no
  // school or author — and the columns are required, so the insert would fail.
  const [account] = options.account
    ? await db.select().from(users).where(eq(users.email, options.account.toLowerCase())).limit(1)
    : await db.select().from(users).where(eq(users.role, 'spravce')).orderBy(asc(users.createdAt)).limit(1)
  if (!account) {
    console.error(
      options.account
        ? `Účet ${options.account} v databázi není.`
        : 'V databázi není žádný správce — založ ho skriptem `pnpm --filter @testmaker/web uzivatel`.',
    )
    process.exit(1)
  }
  const scopeAccount = { schoolId: account.schoolId, userId: account.id, role: account.role }
  console.log(`generuje se za účet ${account.email} (${account.name})`)

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
    // A topic without usable text would just fail.
    .where(and(eq(topics.schoolId, account.schoolId), scope, eq(topics.lowContent, false)))
    .orderBy(topics.name)

  const ladder = readAiLadder()
  console.log(
    ladder.length > 1
      ? `žebříček modelů: ${ladder.map(describeAiConfig).join(' → ')}`
      : `model ${ladder[0] ? describeAiConfig(ladder[0]) : '—'}`,
  )
  console.log(`témat v rozsahu: ${rows.length}`)

  let created = 0
  let failed = 0
  /** What the whole run used — at the end it shows whether models were switched. */
  const usedModels = new Set<string>()
  async function runTopic(topic: (typeof rows)[number], index: number): Promise<void> {
    const label = `${index + 1}/${rows.length} ${topic.grade ? `${topic.grade} · ` : ''}${topic.name}`

    const wanted = await resolveCount(scopeAccount, topic.id, {
      ...DEFAULT_GENERATE_PARAMS,
      count: options.count,
      mode: options.mode,
    })
    if (options.mode === 'target' && wanted === 0) {
      console.log(`${label}: přeskočeno, počet je naplněný`)
      return
    }
    if (options.mode === 'add' && !options.force) {
      const [existing] = await db
        .select({ value: sql<number>`count(*)` })
        .from(questions)
        .where(
          and(
            eq(questions.schoolId, account.schoolId),
            eq(questions.topicId, topic.id),
            ne(questions.status, 'rejected'),
          ),
        )
      if (Number(existing?.value ?? 0) > 0) {
        console.log(`${label}: přeskočeno, otázky už má (--force je vygeneruje i tak)`)
        return
      }
    }

    const started = Date.now()
    try {
      const outcome = await generateForTopic(scopeAccount, topic.id, {
        ...DEFAULT_GENERATE_PARAMS,
        count: options.count,
        mode: options.mode,
      })
      created += outcome.created
      for (const model of outcome.models) usedModels.add(model)
      console.log(
        `${label}: ${outcome.created} otázek za ${Math.round((Date.now() - started) / 1000)} s` +
          (outcome.rejected > 0 ? `, ${outcome.rejected} zahozeno` : '') +
          (outcome.failedCalls > 0 ? `, ${outcome.failedCalls}× model neodpověděl použitelně` : '') +
          // Quality differs between models — for a topic that switched midway
          // the output must make it visible.
          (outcome.models.length > 1
            ? `, míchané modely: ${outcome.models.join(' → ')}`
            : outcome.models.length === 1 && ladder.length > 1
              ? `, model ${outcome.models[0]}`
              : ''),
      )
    } catch (error) {
      failed += 1
      const { describeAiError } = await import('@testmaker/core/ai')
      console.log(`${label}: ${describeAiError(error).message}`)
    }
  }

  for (const [index, topic] of rows.entries()) {
    try {
      await runTopic(topic, index)
    } catch (error) {
      failed += 1
      const { describeAiError } = await import('@testmaker/core/ai')
      console.log(`${index + 1}/${rows.length} ${topic.name}: ${describeAiError(error).message}`)
    }
  }

  console.log(
    `hotovo: ${created} nových otázek, ${failed} témat skončilo chybou` +
      (usedModels.size > 0 ? `, použité modely: ${[...usedModels].join(', ')}` : ''),
  )
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
