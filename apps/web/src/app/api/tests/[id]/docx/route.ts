import { renderTestToDocx } from '@testmaker/core/docx'
import { loadRenderableTest } from '@/lib/tests'
import { t } from '@testmaker/core/i18n'
import { withScope } from '@/lib/user'

export const runtime = 'nodejs'

/**
 * The test as a Word document to edit further. `variant=A|B`. Always the
 * blank pupil version — the filled-in teacher's copy stays a PDF.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(async (account) => {
    const { id } = await params
    const variant = new URL(request.url).searchParams.get('variant') === 'B' ? 'B' : 'A'

    // Someone else's test can't get here even with a guessed id: `loadRenderableTest`
    // only lets through own or shared ones.
    const renderable = await loadRenderableTest(account, id, { variant, withKey: false, filled: false })
    if (!renderable) return new Response(t('tests:api.testNotFound'), { status: 404 })

    const buffer = await renderTestToDocx(renderable)
    const safeTitle = renderable.test.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'test'
    const fileName = `${safeTitle} ${variant}.docx`

    return new Response(new Uint8Array(buffer), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'cache-control': 'no-store',
      },
    })
  })
}
