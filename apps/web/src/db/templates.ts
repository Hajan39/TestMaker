/**
 * Built-in templates for one school. Without them no test can be saved
 * (`tests.templateId` is a required foreign key), so every new school gets
 * them and `db/seed.ts` refreshes them in all after every migration.
 *
 * No `@/` alias: the module is also read by the seed run via `tsx`, where the
 * alias does not resolve.
 */
import { and, eq, ne } from 'drizzle-orm'
import { BUILT_IN_TEMPLATES } from '@testmaker/core/schema'
import type { db as Database } from './index'
import { templates } from './schema'

export async function seedTemplates(database: typeof Database, schoolId: string): Promise<void> {
  for (const [index, template] of BUILT_IN_TEMPLATES.entries()) {
    await database
      .insert(templates)
      .values({
        id: await freeId(database, template.slug, schoolId),
        schoolId,
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
}

/**
 * The first school has templates under the short id `builtin-<slug>` (older
 * data and tests refer to it); every other gets an id with a school suffix,
 * because the id is the primary key across the whole table.
 */
async function freeId(database: typeof Database, slug: string, schoolId: string): Promise<string> {
  const short = `builtin-${slug}`
  const [taken] = await database
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.id, short), ne(templates.schoolId, schoolId)))
    .limit(1)
  return taken ? `${short}-${schoolId}` : short
}
