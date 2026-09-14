/** Nasype vestavěné šablony. Spustitelné opakovaně. */
import { BUILT_IN_TEMPLATES } from '@testmaker/core/schema'
import { db, templates } from './index'

async function main() {
  for (const [index, template] of BUILT_IN_TEMPLATES.entries()) {
    await db
      .insert(templates)
      .values({
        id: `builtin-${template.slug}`,
        slug: template.slug,
        name: template.name,
        description: template.description,
        config: template.config,
        builtIn: true,
        position: index,
      })
      .onConflictDoUpdate({
        target: templates.slug,
        set: {
          name: template.name,
          description: template.description,
          config: template.config,
          position: index,
        },
      })
  }
  console.log(`Nasazeno ${BUILT_IN_TEMPLATES.length} vestavěných šablon.`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
