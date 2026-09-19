import { and, eq } from 'drizzle-orm'
import { templateConfigSchema } from '@testmaker/core/schema'
import { sampleRenderableTest } from '@testmaker/core/pdf'
import { renderTestToBuffer } from '@testmaker/core/pdf/node'
import { db, templates } from '@/db'
import { skola, sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'

/** Náhled šablony: ukázkový test vykreslený jejím nastavením. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return sRozsahem(async (ucet) => {
  const { id } = await params
  const graded = new URL(request.url).searchParams.get('graded') !== '0'

  const [row] = await db
    .select()
    .from(templates)
    .where(and(skola(ucet, templates), eq(templates.id, id)))
    .limit(1)
  if (!row) return new Response('Šablona nenalezena', { status: 404 })

  const buffer = await renderTestToBuffer(
    sampleRenderableTest(
      {
        id: row.id,
        name: row.name,
        description: row.description,
        config: templateConfigSchema.parse(row.config),
        builtIn: row.builtIn,
      },
      graded,
    ),
  )

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': 'inline',
      // Náhled se mění jen se šablonou; při jejím uložení se URL doplní o verzi.
      'cache-control': 'private, max-age=60',
    },
  })
  })
}
