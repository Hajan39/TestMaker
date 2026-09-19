/**
 * Nasype vestavěné šablony a — v prostředí bez přihlašování — také školu
 * a výchozí účet, pod kterým se pracuje lokálně a v testech v prohlížeči.
 * Spustitelné opakovaně.
 */
import { eq } from 'drizzle-orm'
import { BUILT_IN_TEMPLATES } from '@testmaker/core/schema'
import { VYCHOZI_UCET_ID } from '../lib/vychozi'
import { db, schools, templates, users } from './index'

/** Škola, do které patří data lokálního vývoje a testů v prohlížeči. */
export const VYVOJ_SKOLA_ID = 'skola-vyvoj'

async function main() {
  await db
    .insert(schools)
    .values({ id: VYVOJ_SKOLA_ID, name: 'Vývoj', slug: 'vyvoj' })
    .onConflictDoNothing()

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

  for (const [index, template] of BUILT_IN_TEMPLATES.entries()) {
    await db
      .insert(templates)
      .values({
        id: `builtin-${template.slug}`,
        schoolId: VYVOJ_SKOLA_ID,
        slug: template.slug,
        name: template.name,
        description: template.description,
        config: template.config,
        builtIn: true,
        position: index,
      })
      .onConflictDoUpdate({
        target: [templates.schoolId, templates.slug],
        set: {
          name: template.name,
          description: template.description,
          config: template.config,
          position: index,
        },
      })
  }

  const [pocet] = await db.select({ id: templates.id }).from(templates).where(eq(templates.builtIn, true))
  console.log(`Nasazeno ${BUILT_IN_TEMPLATES.length} vestavěných šablon${pocet ? '' : ''}.`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
