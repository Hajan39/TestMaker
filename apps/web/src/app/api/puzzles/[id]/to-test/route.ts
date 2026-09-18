import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, testItems, tests } from '@/db'
import { newId } from '@/lib/ids'
import { loadPuzzle } from '@/lib/puzzles'
import { buildPuzzleSnapshots } from '@/lib/tests'

export const runtime = 'nodejs'

const bodySchema = z.object({ testId: z.string().min(1) })

/**
 * Zařadí hotový hlavolam na konec písemky jako pátý druh položky.
 *
 * Skládá se tady na serveru, ne v prohlížeči: spolu s položkou vzniká
 * i zmrazený snímek hlavolamu, aby se pozdější úpravou v knihovně
 * nezměnila už hotová písemka.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: 'Chybí písemka' }, { status: 400 })

  const puzzle = await loadPuzzle(id)
  if (!puzzle) return Response.json({ error: 'Hlavolam se nenašel' }, { status: 404 })

  const [test] = await db
    .select({ id: tests.id, title: tests.title })
    .from(tests)
    .where(eq(tests.id, parsed.data.testId))
    .limit(1)
  if (!test) return Response.json({ error: 'Písemka se nenašla' }, { status: 404 })

  const [last] = await db
    .select({ position: testItems.position })
    .from(testItems)
    .where(eq(testItems.testId, test.id))
    .orderBy(desc(testItems.position))
    .limit(1)

  const snapshots = await buildPuzzleSnapshots([puzzle.id])
  await db.insert(testItems).values({
    id: newId(),
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
  await db.update(tests).set({ updatedAt: new Date().toISOString() }).where(eq(tests.id, test.id))

  return Response.json({ testId: test.id, testTitle: test.title })
}
