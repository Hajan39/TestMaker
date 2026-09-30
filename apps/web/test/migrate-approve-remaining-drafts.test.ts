import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Migrace 0014 dorovnává zbylé koncepty (`draft`) na schválené, teď když
 * schvalování zmizelo úplně. Testuje se stejně jako 0006: vlastní databáze
 * postavená migracemi po `0013_puzzle-word-drafts`, do ní vložené otázky ve
 * všech třech stavech, a teprve pak plná sada migrací.
 */
// Datové migrace ze staré řady; čistá databáze dnes vzniká jediným základem.
const drizzleFolder = resolve(import.meta.dirname, '..', 'drizzle-historie')
const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    try {
      cleanup()
    } catch {}
  }
})

/** Kopie složky migrací, ve které rejstřík končí u zadané migrace. */
function migrationsUpTo(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'testmaker-drizzle-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  cpSync(drizzleFolder, dir, { recursive: true })

  const journalPath = join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[]
  }
  const end = journal.entries.findIndex((entry) => entry.tag === tag)
  expect(end).toBeGreaterThanOrEqual(0)
  journal.entries = journal.entries.slice(0, end + 1)
  writeFileSync(journalPath, JSON.stringify(journal, null, 2))
  return dir
}

function freshDb(): { client: Client; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'testmaker-migrace-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'migrace.db')
  const client = createClient({ url: `file:${file}` })
  cleanups.push(() => client.close())
  return { client, file }
}

async function insertQuestion(client: Client, id: string, status: string): Promise<void> {
  await client.execute({
    sql: `INSERT INTO questions (id, topic_id, material_id, type, payload, blocks, points, difficulty, source, status)
          VALUES (?, NULL, NULL, 'short_answer', ?, '[]', 1, 2, 'ai', ?)`,
    args: [id, JSON.stringify({ prompt: `Otázka ${id}`, answer: 'x', acceptedAnswers: [] }), status],
  })
}

async function countsByStatus(client: Client): Promise<Record<string, number>> {
  const result = await client.execute('SELECT status, count(*) AS pocet FROM questions GROUP BY status')
  return Object.fromEntries(result.rows.map((row) => [String(row.status), Number(row.pocet)]))
}

/** Hash migrace tak, jak ho počítá `drizzle-orm/migrator.js` — sha256 celého souboru. */
function migrationHash(tag: string): string {
  const contents = readFileSync(join(drizzleFolder, `${tag}.sql`), 'utf8')
  return createHash('sha256').update(contents).digest('hex')
}

describe('migrace 0014 — zbylé koncepty na schválené', () => {
  it('překlopí zbylé koncepty a jen je poznamená do vlastní pomocné tabulky', async () => {
    const { client } = freshDb()
    await migrate(drizzle(client), { migrationsFolder: migrationsUpTo('0013_puzzle-word-drafts') })

    await insertQuestion(client, 'koncept-1', 'draft')
    await insertQuestion(client, 'koncept-2', 'draft')
    await insertQuestion(client, 'schvalena', 'approved')
    await insertQuestion(client, 'zamitnuta', 'rejected')

    expect(await countsByStatus(client)).toEqual({ draft: 2, approved: 1, rejected: 1 })

    await migrate(drizzle(client), { migrationsFolder: drizzleFolder })

    // Koncepty zmizely, schválených je o ně víc, zamítnutá zůstala zamítnutá.
    expect(await countsByStatus(client)).toEqual({ approved: 3, rejected: 1 })

    // Pomocná tabulka obsahuje přesně otázky, kterých se to týkalo.
    const noted = await client.execute(
      'SELECT question_id FROM migration_0014_approved_drafts ORDER BY question_id',
    )
    expect(noted.rows.map((row) => String(row.question_id))).toEqual(['koncept-1', 'koncept-2'])
  })

  it('jde vrátit zpět postupem z komentáře v migraci a zamítnutou mezitím otázku nechá být', async () => {
    const { client } = freshDb()
    await migrate(drizzle(client), { migrationsFolder: migrationsUpTo('0013_puzzle-word-drafts') })

    await insertQuestion(client, 'koncept', 'draft')
    await insertQuestion(client, 'koncept-pozdeji-zamitnuty', 'draft')
    await insertQuestion(client, 'schvalena-rucne', 'approved')

    await migrate(drizzle(client), { migrationsFolder: drizzleFolder })

    // Mezitím učitelka jednu z překlopených otázek zamítne.
    await client.execute("UPDATE questions SET status = 'rejected' WHERE id = 'koncept-pozdeji-zamitnuty'")

    // Návrat zpět podle postupu v `docs/migrace-0014-zbyle-koncepty.md`.
    await client.execute(`UPDATE questions SET status = 'draft'
       WHERE status = 'approved'
         AND id IN (SELECT question_id FROM migration_0014_approved_drafts)`)
    await client.execute('DROP TABLE migration_0014_approved_drafts')
    await client.execute({
      sql: 'DELETE FROM __drizzle_migrations WHERE hash = ?',
      args: [migrationHash('0014_approve-remaining-drafts')],
    })

    expect(await countsByStatus(client)).toEqual({ draft: 1, approved: 1, rejected: 1 })

    const stavy = await client.execute('SELECT id, status FROM questions ORDER BY id')
    expect(Object.fromEntries(stavy.rows.map((row) => [String(row.id), String(row.status)]))).toEqual({
      koncept: 'draft',
      'koncept-pozdeji-zamitnuty': 'rejected',
      'schvalena-rucne': 'approved',
    })

    // Záznam o migraci zmizel z evidence drizzle — příští `pnpm db:migrate`
    // ji spustí znovu, místo aby ji považoval za hotovou.
    const zbyvajici = await client.execute({
      sql: 'SELECT hash FROM __drizzle_migrations WHERE hash = ?',
      args: [migrationHash('0014_approve-remaining-drafts')],
    })
    expect(zbyvajici.rows).toHaveLength(0)
  })

  it('nad databází bez konceptů proběhne bez chyby a nic nezmění', async () => {
    const { client } = freshDb()
    await migrate(drizzle(client), { migrationsFolder: migrationsUpTo('0013_puzzle-word-drafts') })

    await insertQuestion(client, 'schvalena', 'approved')
    await insertQuestion(client, 'zamitnuta', 'rejected')

    await migrate(drizzle(client), { migrationsFolder: drizzleFolder })

    expect(await countsByStatus(client)).toEqual({ approved: 1, rejected: 1 })
    const noted = await client.execute('SELECT question_id FROM migration_0014_approved_drafts')
    expect(noted.rows).toHaveLength(0)
  })
})
