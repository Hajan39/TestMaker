import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { afterEach, describe, expect, it } from 'vitest'
import { POMOCNE_TABULKY, SLOZKA_HISTORIE, SLOZKA_ZAKLADU, migrovat, porovnatSeZakladem } from '@/db/migrace'

/**
 * Čistý základ a převod databáze ze staré řady migrací. Každý test má vlastní
 * databázi v paměti — sdílená databáze z `test/setup.ts` už je na základu
 * a starou řadu by neukázala. Soubor ne: libsql ho na Windows drží i po
 * `close()` a dočasná složka by nešla smazat.
 */
const uklid: (() => void)[] = []

/** Základ a migrace, které přibyly po něm. */
const POCET_MIGRACI = readMigrationFiles({ migrationsFolder: SLOZKA_ZAKLADU }).length

afterEach(() => {
  for (const krok of uklid.splice(0)) krok()
})

function novaDatabaze(): Client {
  const client = createClient({ url: ':memory:' })
  uklid.push(() => client.close())
  return client
}

async function tabulky(client: Client): Promise<string[]> {
  const rows = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
  return rows.rows.map((r) => String(r.name))
}

describe('čistá databáze', () => {
  it('vznikne jediným základem, bez pomocných tabulek a bez dat', async () => {
    const client = novaDatabaze()
    expect(await migrovat(client)).toBe('aktualni')

    const jmena = await tabulky(client)
    for (const pomocna of POMOCNE_TABULKY) expect(jmena).not.toContain(pomocna)
    expect((await client.execute('SELECT COUNT(*) AS n FROM __drizzle_migrations')).rows[0]?.n).toBe(POCET_MIGRACI)
    expect((await client.execute('SELECT COUNT(*) AS n FROM schools')).rows[0]?.n).toBe(0)
    expect((await client.execute('SELECT COUNT(*) AS n FROM users')).rows[0]?.n).toBe(0)
  })
})

describe('převod ze staré řady', () => {
  async function staraDatabaze(): Promise<Client> {
    const client = novaDatabaze()
    await migrate(drizzle(client), { migrationsFolder: SLOZKA_HISTORIE })
    // Stará řada si založila školu a účet sama (migrace 0011); přidáme obsah.
    await client.batch(
      [
        "INSERT INTO subjects (id, school_id, name) VALUES ('predmet-1', 'skola-zakladatelka', 'PŘÍRODOPIS')",
        "INSERT INTO grades (id, school_id, subject_id, name) VALUES ('rocnik-1', 'skola-zakladatelka', 'predmet-1', '6. ročník')",
      ],
      'write',
    )
    return client
  }

  it('zachová data, zahodí pomocné tabulky a schéma srovná se základem', async () => {
    const client = await staraDatabaze()
    expect((await porovnatSeZakladem(client)).length).toBeGreaterThan(0)

    expect(await migrovat(client)).toBe('prevedeno')

    expect(await porovnatSeZakladem(client)).toEqual([])
    const jmena = await tabulky(client)
    for (const pomocna of POMOCNE_TABULKY) expect(jmena).not.toContain(pomocna)
    expect(jmena.some((j) => j.startsWith('__prestavba_'))).toBe(false)
    expect((await client.execute('SELECT COUNT(*) AS n FROM __drizzle_migrations')).rows[0]?.n).toBe(POCET_MIGRACI)

    const rocnik = await client.execute("SELECT name, subject_id FROM grades WHERE id = 'rocnik-1'")
    expect(rocnik.rows[0]).toMatchObject({ name: '6. ročník', subject_id: 'predmet-1' })
    expect((await client.execute('PRAGMA foreign_key_check')).rows).toEqual([])
  })

  it('po převodu už cizí klíče mažou kaskádou jako v základu', async () => {
    const client = await staraDatabaze()
    await migrovat(client)
    await client.execute('PRAGMA foreign_keys = ON')
    await client.execute("DELETE FROM subjects WHERE id = 'predmet-1'")
    expect((await client.execute("SELECT COUNT(*) AS n FROM grades")).rows[0]?.n).toBe(0)
  })

  it('druhý běh už nic nepřevádí', async () => {
    const client = await staraDatabaze()
    await migrovat(client)
    expect(await migrovat(client)).toBe('aktualni')
  })

  it('schéma, které převod neumí opravit, nechá beze změny a ohlásí', async () => {
    const client = await staraDatabaze()
    await client.execute('ALTER TABLE subjects ADD COLUMN navic text')

    await expect(migrovat(client)).rejects.toThrow(/navíc sloupec subjects\.navic/)
    const jmena = await tabulky(client)
    expect(jmena).toContain('migration_0011_vlastnictvi')
    expect((await client.execute('SELECT COUNT(*) AS n FROM __drizzle_migrations')).rows[0]?.n).toBeGreaterThan(1)
  })
})
