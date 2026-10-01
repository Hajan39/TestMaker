/**
 * Transfers the finished library from the computer to the production database (Turso).
 *
 *   TARGET_DATABASE_URL=libsql://…  TARGET_DATABASE_AUTH_TOKEN=…  \
 *     pnpm --filter @testmaker/web push:remote            # only counts, writes nothing
 *     pnpm --filter @testmaker/web push:remote -- --zapsat
 *
 * Why database straight to database and not through the app: a request on
 * Vercel may be at most 4.5 MB and functions run only for a limited time. This
 * script runs on the owner's computer, talks to Turso directly and none of
 * those caps apply — 268 materials with full texts go through in one run.
 *
 * The run can be repeated at any time: it writes `insert … on conflict(id) do
 * update`, so a second run duplicates nothing and only aligns what changed
 * meanwhile. If a run is interrupted halfway, just start it again.
 *
 * The generation queue (`generation_jobs`) is not transferred — it is one
 * computer's working state, not library content.
 *
 * The school must be given (`--skola <id>`) and applies to both reading and
 * writing: without it the content of two schools could accidentally be merged
 * into one and nobody could pull it apart again. An owner who does not exist in
 * the target is replaced by the account from `--ucet`.
 */
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import * as schema from '../src/db/schema'
import {
  TABLE_ORDER,
  readTable,
  existingTables,
  emptyCounts,
  countRows,
  writeSelfReferences,
  writeRows,
  type BackupDb,
  type TableName,
  type SelfReference,
} from '../src/lib/backup'
import { tableLabel } from '../src/lib/backupClient'

const write = process.argv.includes('--zapsat')
const dryRun = !write || process.argv.includes('--dry-run')

/** Value of a `--name value` switch. */
function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const schoolId = flag('skola')
const accountId = flag('ucet')

/**
 * The target is deliberately not taken from `DATABASE_URL`. That points to the
 * source (a local file), and if the target came from it too, forgetting one
 * variable would make the script overwrite the library with itself.
 */
const targetUrl = process.env.TARGET_DATABASE_URL
const targetToken = process.env.TARGET_DATABASE_AUTH_TOKEN
const sourceUrl = process.env.SOURCE_DATABASE_URL || 'file:./local.db'

function end(message: string): never {
  console.error(message)
  process.exit(1)
}

async function main() {
  if (!schoolId || !accountId) {
    end(
      'Chybí --skola <id> a --ucet <id>. Škola určuje, co se přenáší a kam se to ' +
        'zapíše; účet dostane obsah, jehož původní vlastník v cíli není. ' +
        'Id najdeš v tabulkách `schools` a `users`.',
    )
  }
  if (!targetUrl) {
    end(
      'Chybí TARGET_DATABASE_URL — adresa databáze, do které se má přenášet ' +
        '(v Tursu `turso db show <jméno> --url`). Spolu s ní obvykle i ' +
        'TARGET_DATABASE_AUTH_TOKEN.',
    )
  }
  if (targetUrl === sourceUrl) {
    end('TARGET_DATABASE_URL je totéž co zdroj — to by knihovna přepsala sama sebe.')
  }

  const sourceClient = createClient({ url: sourceUrl })
  const targetClient = createClient({ url: targetUrl, authToken: targetToken })
  const source = drizzle(sourceClient, { schema }) as BackupDb
  const target = drizzle(targetClient, { schema }) as BackupDb

  console.log(`Zdroj: ${sourceUrl}`)
  console.log(`Cíl:   ${targetUrl}`)
  console.log('')

  await checkSchema(target)

  const before = await countRows(target, { schoolId: schoolId })
  const sourceCounts = await countRows(source, { schoolId: schoolId })

  if (dryRun) {
    console.log('Nanečisto (--dry-run): nic se nezapisuje.\n')
    printTable(sourceCounts, before)
    console.log('\nSkutečný přenos spustíš s přepínačem --zapsat.')
    sourceClient.close()
    targetClient.close()
    return
  }

  const inSource = await existingTables(source)
  const transferred = emptyCounts()
  for (const name of TABLE_ORDER) {
    if (!inSource.has(name)) {
      // The source is older than the app — the table does not exist there yet
      // and there is nothing to transfer.
      console.log(`${name}: ve zdroji není, přeskakuji`)
      continue
    }
    const links: SelfReference[] = []
    let done = 0
    for await (const batch of readTable(source, name, { schoolId: schoolId })) {
      const result = await writeRows(target, name, batch, { schoolId: schoolId, userId: accountId })
      links.push(...result.links)
      done += result.written
      if (sourceCounts[name] > 0) progress(`${name}: ${done}/${sourceCounts[name]}`)
    }
    transferred[name] = done
    let appended = 0
    if (links.length > 0) appended = await writeSelfReferences(target, links, { schoolId: schoolId })
    if (sourceCounts[name] > 0) {
      doneRow(
        `${name}: ${done}/${sourceCounts[name]}` +
          (links.length > 0 ? ` (${name === 'questions' ? 'verze' : 'duplicity'}: ${appended})` : ''),
      )
    }
  }

  console.log('')
  const after = await countRows(target, { schoolId: schoolId })
  printTable(sourceCounts, after, transferred)

  const missing = TABLE_ORDER.filter((name) => after[name] < sourceCounts[name])
  if (missing.length > 0) {
    console.log(
      `\nV cíli je míň řádků než ve zdroji (${missing.join(', ')}). Spusť přenos znovu; ` +
        'opakovaný běh nic nezdvojí.',
    )
  } else {
    console.log('\nHotovo. V cíli je všechno, co je ve zdroji.')
  }

  sourceClient.close()
  targetClient.close()
}

/**
 * Progress of a long table. In a terminal the line is overwritten; in
 * redirected output (a run log) it would be an unreadable mess, so it stays
 * silent there and only the finished table is printed.
 */
function progress(text: string): void {
  if (process.stdout.isTTY) process.stdout.write(`\r${text}   `)
}

/** A finished table — always printed, even to a file. */
function doneRow(text: string): void {
  if (process.stdout.isTTY) process.stdout.write('\r')
  console.log(`${text}   `)
}

/**
 * The target database must have the schema — GitHub Actions runs migrations
 * there (`.github/workflows/migrate.yml`), not this script. Without this check
 * the transfer would fail midway on an unhelpful "no such table".
 */
async function checkSchema(target: BackupDb): Promise<void> {
  const result = await target.run(sql`select name from sqlite_master where type = 'table'`)
  const tables = new Set(result.rows.map((row) => String(row.name)))
  const missing = TABLE_ORDER.filter((name) => !tables.has(name))
  if (missing.length > 0) {
    end(
      `V cílové databázi chybí tabulky (${missing.join(', ')}). Nejdřív tam pusť migrace — ` +
        've workflow „migrate“ na GitHubu, nebo z počítače:\n' +
        '  DATABASE_URL=$TARGET_DATABASE_URL DATABASE_AUTH_TOKEN=$TARGET_DATABASE_AUTH_TOKEN \\\n' +
        '    pnpm --filter @testmaker/web db:migrate',
    )
  }
}

/** Overview of "what is in the source / what is in the target", so the difference is visible at a glance. */
function printTable(
  source: Record<TableName, number>,
  target: Record<TableName, number>,
  transferred?: Record<TableName, number>,
): void {
  const width = Math.max(...TABLE_ORDER.map((name) => tableLabel(name).length))
  console.log(
    `${'tabulka'.padEnd(width)}  ${'zdroj'.padStart(7)}  ${'cíl'.padStart(7)}` +
      (transferred ? `  ${'posláno'.padStart(7)}` : ''),
  )
  for (const name of TABLE_ORDER) {
    console.log(
      `${tableLabel(name).padEnd(width)}  ${String(source[name]).padStart(7)}  ` +
        `${String(target[name]).padStart(7)}` +
        (transferred ? `  ${String(transferred[name]).padStart(7)}` : ''),
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
