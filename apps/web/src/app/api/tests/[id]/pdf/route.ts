import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { TestDocument } from '@testmaker/core/pdf'
import { registerServerFonts } from '@testmaker/core/pdf/node'
import { loadRenderableTest } from '@/lib/tests'

export const runtime = 'nodejs'
export const maxDuration = 120

registerServerFonts()

/** Vykreslí test do PDF. `variant=A|B`, `key=1` přidá klíč, `key=only` vrátí jen klíč. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const url = new URL(request.url)
  const variant = url.searchParams.get('variant') === 'B' ? 'B' : 'A'
  const keyParam = url.searchParams.get('key')

  const renderable = await loadRenderableTest(id, {
    variant,
    withKey: keyParam === '1' || keyParam === 'only',
  })
  if (!renderable) return new Response('Test nenalezen', { status: 404 })

  const buffer = await renderToBuffer(createElement(TestDocument, renderable) as never)
  const safeTitle = renderable.test.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'test'
  const fileName = `${safeTitle} ${variant}${keyParam ? ' + klíč' : ''}.pdf`

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'cache-control': 'no-store',
    },
  })
}
