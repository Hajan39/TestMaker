import { renderTestToBuffer } from '@testmaker/core/pdf/node'
import { loadRenderableTest } from '@/lib/tests'
import { t } from '@testmaker/core/i18n'
import { withScope } from '@/lib/user'

export const runtime = 'nodejs'
export const maxDuration = 120

/** Renders a test to PDF. `variant=A|B`; `key=1` appends the answer key. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(async (account) => {
  const { id } = await params
  const url = new URL(request.url)
  const variant = url.searchParams.get('variant') === 'B' ? 'B' : 'A'
  const withKey = url.searchParams.get('key') === '1'

  // Someone else's test can't get here even with a guessed id: `loadRenderableTest`
  // only lets through own or shared ones.
  const renderable = await loadRenderableTest(account, id, { variant, withKey })
  if (!renderable) return new Response(t('tests:api.testNotFound'), { status: 404 })

  const buffer = await renderTestToBuffer(renderable)
  const safeTitle = renderable.test.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'test'
  const fileName = `${safeTitle} ${variant}${withKey ? t('tests:pdfFile.keySuffix') : ''}.pdf`

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'cache-control': 'no-store',
    },
  })
  })
}
