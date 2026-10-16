import { and, eq } from 'drizzle-orm'
import { t } from '@testmaker/core/i18n'
import { db, materials } from '@/db'
import { inSchool, withScope } from '@/lib/user'

export const runtime = 'nodejs'

/**
 * Extracted text of one material for the preview. Loaded only when the
 * preview opens — a topic page with all its texts inline would be megabytes.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(async (account) => {
    const { id } = await params
    const [row] = await db
      .select({ text: materials.text })
      .from(materials)
      .where(and(inSchool(account, materials), eq(materials.id, id)))
      .limit(1)
    if (!row) return Response.json({ error: t('library:materialsApi.materialGone') }, { status: 404 })
    return Response.json({ text: row.text })
  })
}
