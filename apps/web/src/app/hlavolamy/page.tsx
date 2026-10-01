import type { Metadata } from 'next'
import { t } from '@testmaker/core/i18n'
import { PageShell } from '@testmaker/ui'
import { aiStatus } from '@/lib/ai'
import { loadPuzzleList, loadPuzzleTopics } from '@/lib/puzzles'
import { loadTemplates } from '@/lib/tests'
import { PuzzleWorkshop } from './PuzzleWorkshop'
import { pageAccount } from '@/lib/user'

export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  return { title: t('puzzles:page.title') }
}

/**
 * Puzzles have their own tab: they are not questions and do not belong in the
 * bank, but finished ones can be printed next to a test or added into it.
 */
export default async function PuzzlesPage() {
  const account = await pageAccount()
  const [topics, puzzles, templates] = await Promise.all([
    loadPuzzleTopics(account),
    loadPuzzleList(account),
    loadTemplates(account),
  ])

  return (
    <PageShell>
      <PuzzleWorkshop
        topics={topics}
        puzzles={puzzles}
        // The on-screen preview is drawn on the same sheet as a test, so it
        // needs a template; the first built-in one will do, a puzzle differs
        // from it only in margins and font.
        templateConfig={templates[0]?.config ?? null}
        aiConfigured={aiStatus().configured}
      />
    </PageShell>
  )
}
