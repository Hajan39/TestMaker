import { renderTestToBuffer } from '@testmaker/core/pdf/node'
import { loadRenderablePuzzle } from '@/lib/puzzles'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * Hlavolam do PDF. `key=1` přiloží řešení pro učitelku — vyplněnou mřížku
 * i seznam, kde které slovo leží.
 *
 * Tiskne se toutéž cestou jako písemka (`renderTestToBuffer`): hlavolam je
 * položka testu, jen v takovém testu není nic jiného.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return sRozsahem(async (ucet) => {
  const { id } = await params
  const withKey = new URL(request.url).searchParams.get('key') === '1'

  // Bez kontroly vlastníka by stačilo uhodnout id a cizí hlavolam si vytisknout.
  const renderable = await loadRenderablePuzzle(ucet, id, { withKey })
  if (!renderable) return new Response('Hlavolam nenalezen', { status: 404 })

  const buffer = await renderTestToBuffer(renderable)
  const safeTitle = renderable.test.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'hlavolam'
  const fileName = `${safeTitle}${withKey ? ' + řešení' : ''}.pdf`

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'cache-control': 'no-store',
    },
  })
  })
}
