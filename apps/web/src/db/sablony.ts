/**
 * Vestavěné šablony pro jednu školu. Bez nich nejde uložit písemku
 * (`tests.templateId` je povinný cizí klíč), takže je dostává každá nová
 * škola a `db/seed.ts` je po každé migraci obnoví ve všech.
 *
 * Bez aliasu `@/`: modul čte i seed spouštěný přes `tsx`, kde se alias
 * nerozřeší.
 */
import { and, eq, ne } from 'drizzle-orm'
import { BUILT_IN_TEMPLATES } from '@testmaker/core/schema'
import type { db as Databaze } from './index'
import { templates } from './schema'

export async function nasaditSablony(databaze: typeof Databaze, schoolId: string): Promise<void> {
  for (const [index, template] of BUILT_IN_TEMPLATES.entries()) {
    await databaze
      .insert(templates)
      .values({
        id: await volneId(databaze, template.slug, schoolId),
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
 * První škola má šablony pod krátkým id `builtin-<slug>` (na něj se odkazují
 * starší data i testy); každá další dostane id s příponou školy, protože id je
 * primární klíč napříč celou tabulkou.
 */
async function volneId(databaze: typeof Databaze, slug: string, schoolId: string): Promise<string> {
  const kratke = `builtin-${slug}`
  const [obsazene] = await databaze
    .select({ id: templates.id })
    .from(templates)
    .where(and(eq(templates.id, kratke), ne(templates.schoolId, schoolId)))
    .limit(1)
  return obsazene ? `${kratke}-${schoolId}` : kratke
}
