import { renderTestToBuffer } from '@testmaker/core/pdf/node'
import { t } from '@testmaker/core/i18n'
import { resolveShareToken } from '@/lib/share'
import { loadRenderableTest } from '@/lib/tests'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * PDF behind a print link — without sign-in, the token is the permission.
 * Always the blank pupil version: `withKey` and `filled` are fixed here, no
 * query parameter can ask for the solutions. `varianta=A|B` picks the variant.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const shared = await resolveShareToken(token)
  const expired = () => new Response(t('tests:share.page.expiredTitle'), { status: 404 })
  if (!shared) return expired()

  const variant = new URL(request.url).searchParams.get('varianta') === 'B' ? 'B' : 'A'
  const renderable = await loadRenderableTest(shared.scope, shared.testId, { variant, withKey: false, filled: false })
  if (!renderable) return expired()

  const buffer = await renderTestToBuffer(renderable)
  const safeTitle = renderable.test.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'test'
  const fileName = `${safeTitle} ${variant}.pdf`
  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'cache-control': 'no-store',
    },
  })
}
