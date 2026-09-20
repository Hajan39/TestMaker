/**
 * Hromadné generování otázek z příkazové řádky.
 *
 * Fronta v aplikaci potřebuje otevřené okno; přes tenhle skript jde nechat
 * projet celý ročník nebo celou knihovnu na pozadí, třeba přes noc. Při
 * nastavení Ollama workerů témata zpracovává přes omezenou paralelní frontu.
 *
 * Příklady:
 *   pnpm --filter @testmaker/web generate:bulk -- --grade <id> --count 10
 *   pnpm --filter @testmaker/web generate:bulk -- --subject <id> --target 12
 *   pnpm --filter @testmaker/web generate:bulk -- --all --target 10 --model gemini-flash-lite-latest
 *   pnpm --filter @testmaker/web generate:bulk -- --all --models google:gemini-flash-latest,google:gemini-flash-lite-latest
 *
 * `--count` vytvoří tolik nových otázek, `--target` doplní téma na tenhle
 * celkový počet. Bez `--force` se přeskakují témata, která už otázky mají
 * (u `--target` se přeskočí jen ta, kde je počet naplněný).
 *
 * `--models` je žebříček (totéž co proměnná `AI_MODELS`): když prvnímu modelu
 * dojde denní limit, běh pokračuje dalším a nespadne celý ročník. Placený
 * model se do žebříčku dostane jen tím, že ho tam napíšeš.
 *
 * `--ucet <e-mail>` říká, za koho se generuje: otázky dostanou jeho školu
 * a jeho jako autora. Bez něj se vezme první správce v databázi — na
 * jednoškolní instalaci je to právě ten, kdo skript spouští.
 */
import { existsSync, readFileSync } from 'node:fs'

interface Options {
  gradeId?: string
  subjectId?: string
  all: boolean
  count: number
  mode: 'add' | 'target'
  model?: string
  models?: string
  force: boolean
  /** E-mail účtu, za který se generuje. */
  ucet?: string
}

function parseArgs(argv: string[]): Options {
  const options: Options = { all: false, count: 10, mode: 'add', force: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--ucet') options.ucet = next
    else if (arg === '--grade') options.gradeId = next
    else if (arg === '--subject') options.subjectId = next
    else if (arg === '--all') options.all = true
    else if (arg === '--count') options.count = Number(next)
    else if (arg === '--target') {
      options.count = Number(next)
      options.mode = 'target'
    } else if (arg === '--model') options.model = next
    else if (arg === '--models') options.models = next
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
  const { describeAiConfig, isAiConfigured, readAiLadder, readOllamaWorkers } = await import('@testmaker/core/ai')
  const { asc } = await import('drizzle-orm')

  // Za koho se generuje. Bez identity by otázky neměly školu ani autora —
  // a sloupce jsou povinné, takže by zápis rovnou spadl.
  const [ucet] = options.ucet
    ? await db.select().from(users).where(eq(users.email, options.ucet.toLowerCase())).limit(1)
    : await db.select().from(users).where(eq(users.role, 'spravce')).orderBy(asc(users.createdAt)).limit(1)
  if (!ucet) {
    console.error(
      options.ucet
        ? `Účet ${options.ucet} v databázi není.`
        : 'V databázi není žádný správce — založ ho skriptem `pnpm --filter @testmaker/web uzivatel`.',
    )
    process.exit(1)
  }
  const scopeUcet = { schoolId: ucet.schoolId, userId: ucet.id, role: ucet.role }
  console.log(`generuje se za účet ${ucet.email} (${ucet.name})`)

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
    .where(and(eq(topics.schoolId, ucet.schoolId), scope, eq(topics.lowContent, false)))
    .orderBy(topics.name)

  const workers = readOllamaWorkers()
  const ladder = workers.length > 0 ? workers : readAiLadder()
  const concurrency =
    workers.length > 0 ? Math.max(1, Math.min(workers.length, Number(process.env.OLLAMA_CONCURRENCY) || 1)) : 1
  console.log(
    workers.length > 0
      ? `Ollama workeři (${concurrency} současně): ${workers.map(describeAiConfig).join(', ')}`
      : ladder.length > 1
        ? `žebříček modelů: ${ladder.map(describeAiConfig).join(' → ')}`
        : `poskytovatel ${ladder[0]?.provider}, model ${ladder[0]?.model}`,
  )
  console.log(`témat v rozsahu: ${rows.length}`)

  let created = 0
  let failed = 0
  /** Co se za celý běh použilo — na konci je vidět, jestli se přepínalo. */
  const usedModels = new Set<string>()
  let nextTopic = 0
  async function runTopic(topic: (typeof rows)[number], index: number, worker?: (typeof workers)[number]): Promise<void> {
    const label = `${index + 1}/${rows.length} ${topic.grade ? `${topic.grade} · ` : ''}${topic.name}`

    const wanted = await resolveCount(scopeUcet, topic.id, {
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
            eq(questions.schoolId, ucet.schoolId),
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
      const outcome = await generateForTopic(scopeUcet, topic.id, {
        ...DEFAULT_GENERATE_PARAMS,
        count: options.count,
        mode: options.mode,
      }, worker ? { worker } : undefined)
      created += outcome.created
      for (const model of outcome.models) usedModels.add(model)
      console.log(
        `${label}: ${outcome.created} otázek za ${Math.round((Date.now() - started) / 1000)} s` +
          (outcome.rejected > 0 ? `, ${outcome.rejected} zahozeno` : '') +
          (outcome.failedCalls > 0 ? `, ${outcome.failedCalls}× model neodpověděl použitelně` : '') +
          // Kvalita se mezi modely liší — u tématu, kde se v půlce přepnulo,
          // to musí být z výpisu poznat.
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

  async function workerLoop(worker?: (typeof workers)[number]): Promise<void> {
    while (true) {
      const index = nextTopic++
      const topic = rows[index]
      if (!topic) return
      try {
        await runTopic(topic, index, worker)
      } catch (error) {
        failed += 1
        const { describeAiError } = await import('@testmaker/core/ai')
        console.log(`${index + 1}/${rows.length} ${topic.name}: ${describeAiError(error).message}`)
      }
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, (_, index) =>
      workerLoop(workers.length > 0 ? workers[index] : undefined),
    ),
  )

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
