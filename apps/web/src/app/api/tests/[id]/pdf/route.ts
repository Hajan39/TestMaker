import { renderTestToBuffer } from '@testmaker/core/pdf/node'
import { loadRenderableTest } from '@/lib/tests'

export const runtime = 'nodejs'
export const maxDuration = 120

/** Vykreslí test do PDF. `variant=A|B`, `key=1` přiloží klíč správných odpovědí. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(request.url)
  const variant = url.searchParams.get('variant') === 'B' ? 'B' : 'A'
  const withKey = url.searchParams.get('key') === '1'

  const renderable = await loadRenderableTest(id, { variant, withKey })
  if (!renderable) return new Response('Test nenalezen', { status: 404 })

  const buffer = await renderTestToBuffer(renderable)
  const safeTitle = renderable.test.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'test'
  const fileName = `${safeTitle} ${variant}${withKey ? ' + klíč' : ''}.pdf`

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'cache-control': 'no-store',
    },
  })
}
