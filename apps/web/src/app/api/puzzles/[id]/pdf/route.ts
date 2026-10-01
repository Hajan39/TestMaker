import { t } from '@testmaker/core/i18n'
import { renderTestToBuffer } from '@testmaker/core/pdf/node'
import { loadPuzzle, loadRenderablePuzzle, puzzleBlockingProblems } from '@/lib/puzzles'
import { withScope } from '@/lib/user'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * A puzzle as PDF. `key=1` attaches the solution for the teacher — the filled
 * grid and the list of where each word lies.
 *
 * It prints along the same path as a test (`renderTestToBuffer`): a puzzle is
 * a test item, there is just nothing else in such a test.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(async (account) => {
  const { id } = await params
  const withKey = new URL(request.url).searchParams.get('key') === '1'

  // Without the owner check, guessing an id would be enough to print a foreign puzzle.
  const puzzle = await loadPuzzle(account, id)
  if (!puzzle) return new Response(t('puzzles:errors.notFoundPlain'), { status: 404 })
  // A broken puzzle is not printed — the paper would lack what the pupil looks for.
  const problems = puzzleBlockingProblems(puzzle)
  if (problems.length > 0) {
    return new Response(t('puzzles:errors.unprintable', { problem: problems[0]!.message }), {
      status: 422,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  const renderable = await loadRenderablePuzzle(account, id, { withKey })
  if (!renderable) return new Response(t('puzzles:errors.notFoundPlain'), { status: 404 })

  const buffer = await renderTestToBuffer(renderable)
  const safeTitle = renderable.test.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || t('puzzles:pdf.fileFallback')
  const fileName = `${safeTitle}${withKey ? t('puzzles:pdf.keySuffix') : ''}.pdf`

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'cache-control': 'no-store',
    },
  })
  })
}
