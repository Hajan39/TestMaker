import { LibraryPanes } from '@/components/LibraryPanes'
import { loadLibraryTree } from '@/lib/library'
import { ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'

/** Obaluje stránku třídy stejným rámem jako téma — zvýrazněný ročník je tenhle. */
export default async function ClassLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ gradeId: string }>
}) {
  const ucet = await ucetStranky()
  const { gradeId } = await params
  const tree = await loadLibraryTree(ucet)
  const grade = tree.flatMap((s) => s.grades).find((g) => g.id === gradeId) ?? null

  return (
    <LibraryPanes tree={tree} grade={grade} contentLabel="Obsah třídy">
      {children}
    </LibraryPanes>
  )
}
