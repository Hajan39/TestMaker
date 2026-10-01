/**
 * Seeds built-in templates into all schools. Into a completely empty local
 * database (file, no school) it also creates the development school and the
 * default account used without sign-in. It does not create them in Turso or
 * in a database that already has a school — they would only get in the way.
 * Safe to run repeatedly.
 */
import { BUILT_IN_TEMPLATES } from '@testmaker/core/schema'
import { DEFAULT_ACCOUNT_ID } from '../lib/defaultAccount'
import { db, schools, users } from './index'
import { seedTemplates } from './templates'

/** The school that local development and browser test data belong to. */
export const DEV_SCHOOL_ID = 'skola-vyvoj'

async function main() {
  const local = (process.env.DATABASE_URL || 'file:./local.db').startsWith('file:')
  const [anySchool] = await db.select({ id: schools.id }).from(schools).limit(1)
  if (local && !anySchool) await createDevSchool()

  // Every school gets templates, not just the development one: without them
  // no test can be saved, and this way a new built-in template reaches all.
  const allSchools = await db.select({ id: schools.id }).from(schools)
  for (const school of allSchools) await seedTemplates(db, school.id)
  console.log(
    `Nasazeno ${BUILT_IN_TEMPLATES.length} vestavěných šablon do ${allSchools.length} škol.`,
  )
}

async function createDevSchool() {
  await db.insert(schools).values({ id: DEV_SCHOOL_ID, name: 'Vývoj', slug: 'vyvoj' })
  // The account must really exist: foreign keys of tests, puzzles and the
  // queue would otherwise have nothing to point to. It has no password —
  // sign-in is off in this environment.
  await db
    .insert(users)
    .values({
      id: DEFAULT_ACCOUNT_ID,
      schoolId: DEV_SCHOOL_ID,
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
