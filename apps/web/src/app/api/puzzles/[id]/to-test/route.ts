import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { t } from '@testmaker/core/i18n'
import { db, testItems, tests } from '@/db'
import { newId } from '@/lib/ids'
import { loadPuzzle, puzzleBlockingProblems } from '@/lib/puzzles'
import { buildPuzzleSnapshots } from '@/lib/tests'
import { inSchool, withScope, ownedBy } from '@/lib/user'

export const runtime = 'nodejs'

const bodySchema = z.object({ testId: z.string().min(1) })

/**
 * Adds a finished puzzle to the end of a test as the fifth item kind.
 *
 * Assembled here on the server, not in the browser: together with the item a
 * frozen snapshot of the puzzle is created, so a later edit in the library
 * does not change an already finished test.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withScope(
    async (account) => {
  const { id } = await params
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: t('puzzles:errors.chooseTest') }, { status: 400 })

  const puzzle = await loadPuzzle(account, id)
  if (!puzzle) return Response.json({ error: t('puzzles:errors.notFound') }, { status: 404 })

  // A broken puzzle (a word did not fit, the cryptogram lacks a letter) must
  // not go into a test: the pupil would look for what is not on the paper.
  const problems = puzzleBlockingProblems(puzzle)
  if (problems.length > 0) {
    return Response.json(
      {
        error: t('puzzles:errors.unaddable', { problem: problems[0]!.message }),
        problems,
      },
      { status: 422 },
    )
  }

  const [test] = await db
    .select({ id: tests.id, title: tests.title })
    .from(tests)
    .where(and(eq(tests.id, parsed.data.testId), ownedBy(account, tests)))
    .limit(1)
  if (!test) return Response.json({ error: t('puzzles:errors.testNotFound') }, { status: 404 })

  const [last] = await db
    .select({ position: testItems.position })
    .from(testItems)
    .where(and(inSchool(account, testItems), eq(testItems.testId, test.id)))
    .orderBy(desc(testItems.position))
    .limit(1)

  const snapshots = await buildPuzzleSnapshots(account, [puzzle.id])
  await db.insert(testItems).values({
    id: newId(),
    schoolId: account.schoolId,
    testId: test.id,
    position: (last?.position ?? -1) + 1,
    kind: 'puzzle',
    questionId: null,
    text: null,
    pointsOverride: null,
    linesOverride: null,
    questionSnapshot: null,
    puzzleId: puzzle.id,
    puzzleSnapshot: snapshots.get(puzzle.id) ?? null,
  })
  await db
    .update(tests)
    .set({ updatedAt: new Date().toISOString() })
    .where(and(eq(tests.id, test.id), ownedBy(account, tests)))

  return Response.json({ testId: test.id, testTitle: test.title })
    },
    { write: true },
  )
}
