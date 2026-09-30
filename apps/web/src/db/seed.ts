/**
 * Nasype vestavěné šablony do všech škol. Do úplně prázdné lokální databáze
 * (soubor, žádná škola) navíc založí vývojovou školu a výchozí účet, pod
 * kterým se pracuje bez přihlašování. Do Tursa ani do databáze, která už
 * nějakou školu má, je nezakládá — tam by jen strašily.
 * Spustitelné opakovaně.
 */
import { BUILT_IN_TEMPLATES } from '@testmaker/core/schema'
import { VYCHOZI_UCET_ID } from '../lib/vychozi'
import { db, schools, users } from './index'
import { nasaditSablony } from './sablony'

/** Škola, do které patří data lokálního vývoje a testů v prohlížeči. */
export const VYVOJ_SKOLA_ID = 'skola-vyvoj'

async function main() {
  const lokalni = (process.env.DATABASE_URL || 'file:./local.db').startsWith('file:')
  const [nejakaSkola] = await db.select({ id: schools.id }).from(schools).limit(1)
  if (lokalni && !nejakaSkola) await zalozitVyvoj()

  // Šablony dostane každá škola, ne jen vývojová: bez nich v ní nejde uložit
  // písemku, a po přidání nové vestavěné šablony ji tak dostanou všechny.
  const vsechnySkoly = await db.select({ id: schools.id }).from(schools)
  for (const skola of vsechnySkoly) await nasaditSablony(db, skola.id)
  console.log(
    `Nasazeno ${BUILT_IN_TEMPLATES.length} vestavěných šablon do ${vsechnySkoly.length} škol.`,
  )
}

async function zalozitVyvoj() {
  await db.insert(schools).values({ id: VYVOJ_SKOLA_ID, name: 'Vývoj', slug: 'vyvoj' })
  // Účet musí existovat doopravdy: cizí klíče u testů, hlavolamů i fronty
  // by jinak neměly na co ukazovat. Heslo nemá — přihlašování je v tomhle
  // prostředí vypnuté.
  await db
    .insert(users)
    .values({
      id: VYCHOZI_UCET_ID,
      schoolId: VYVOJ_SKOLA_ID,
      email: 'vyvoj@localhost',
      name: 'Vývojový správce',
      role: 'spravce',
    })
    .onConflictDoNothing()
  console.log('Založena vývojová škola a výchozí účet.')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
