import { and, eq } from 'drizzle-orm'
import { templateConfigSchema } from '@testmaker/core/schema'
import { sampleRenderableTest } from '@testmaker/core/pdf'
import { renderTestToBuffer } from '@testmaker/core/pdf/node'
import { t } from '@testmaker/core/i18n'
import { db, templates } from '@/db'
import { loadGradeScale } from '@/lib/schools'
import { inSchool, withScope } from '@/lib/user'

export const runtime = 'nodejs'

/** Template preview: a sample test rendered with its settings. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(async (account) => {
  const { id } = await params
  const graded = new URL(request.url).searchParams.get('graded') !== '0'

  const [row] = await db
    .select()
    .from(templates)
    .where(and(inSchool(account, templates), eq(templates.id, id)))
    .limit(1)
  if (!row) return new Response(t('tests:api.templateNotFound'), { status: 404 })

  // The key of the sample prints the school's own grade scale, as a real test would.
  const { scale: gradeScale } = await loadGradeScale(account)
  const buffer = await renderTestToBuffer({
    ...sampleRenderableTest(
      {
        id: row.id,
        name: row.name,
        description: row.description,
        config: templateConfigSchema.parse(row.config),
        builtIn: row.builtIn,
      },
      graded,
    ),
    gradeScale,
  })

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'inline',
      // The preview only changes with the template; saving it adds a version to the URL.
      'cache-control': 'private, max-age=60',
    },
  })
  })
}
