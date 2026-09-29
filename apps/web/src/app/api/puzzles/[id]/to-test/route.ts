import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db, testItems, tests } from '@/db'
import { newId } from '@/lib/ids'
import { loadPuzzle, puzzleBlockingProblems } from '@/lib/puzzles'
import { buildPuzzleSnapshots } from '@/lib/tests'
import { skola, sRozsahem, vlastni } from '@/lib/uzivatel'

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
  return sRozsahem(
    async (ucet) => {
  const { id } = await params
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Vyber písemku, do které se má hlavolam zařadit.' }, { status: 400 })

  const puzzle = await loadPuzzle(ucet, id)
  if (!puzzle) return Response.json({ error: 'Hlavolam se nenašel — možná už je smazaný. Obnov stránku.' }, { status: 404 })

  // Rozbitý hlavolam (slovo se nevešlo, tajence chybí písmeno) do písemky
  // nesmí: žák by hledal, co na papíře není.
  const problems = puzzleBlockingProblems(puzzle)
  if (problems.length > 0) {
    return Response.json(
      {
        error: `Hlavolam se do písemky zařadit nedá: ${problems[0]!.message} Oprav ho v Hlavolamech, ulož a zkus to znovu.`,
        problems,
      },
      { status: 422 },
    )
  }

  const [test] = await db
    .select({ id: tests.id, title: tests.title })
    .from(tests)
    .where(and(eq(tests.id, parsed.data.testId), vlastni(ucet, tests)))
    .limit(1)
  if (!test) return Response.json({ error: 'Písemka se nenašla. Vyber jinou ze svých písemek.' }, { status: 404 })

  const [last] = await db
    .select({ position: testItems.position })
    .from(testItems)
    .where(and(skola(ucet, testItems), eq(testItems.testId, test.id)))
    .orderBy(desc(testItems.position))
    .limit(1)

  const snapshots = await buildPuzzleSnapshots(ucet, [puzzle.id])
  await db.insert(testItems).values({
    id: newId(),
    schoolId: ucet.schoolId,
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
    .where(and(eq(tests.id, test.id), vlastni(ucet, tests)))

  return Response.json({ testId: test.id, testTitle: test.title })
    },
    { zapis: true },
  )
}
