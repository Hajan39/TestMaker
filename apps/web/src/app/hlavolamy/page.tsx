import { PageShell } from '@testmaker/ui'
import { aiStatus } from '@/lib/ai'
import { loadPuzzleList, loadPuzzleTopics } from '@/lib/puzzles'
import { loadTemplates } from '@/lib/tests'
import { PuzzleWorkshop } from './PuzzleWorkshop'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Hlavolamy – TestMaker' }

/**
 * Hlavolamy mají vlastní záložku: nejsou to otázky a do banky nepatří, ale
 * hotové se dají vytisknout na papír vedle písemky i zařadit do ní.
 */
export default async function PuzzlesPage() {
  const [topics, puzzles, templates] = await Promise.all([
    loadPuzzleTopics(),
    loadPuzzleList(),
    loadTemplates(),
  ])

  return (
    <PageShell>
      <PuzzleWorkshop
        topics={topics}
        puzzles={puzzles}
        // Náhled na obrazovce se kreslí do téhož listu jako písemka, proto
        // potřebuje šablonu; první vestavěná stačí, hlavolam se jí liší jen
        // okraji a písmem.
        templateConfig={templates[0]?.config ?? null}
        aiConfigured={aiStatus().configured}
      />
    </PageShell>
  )
}
