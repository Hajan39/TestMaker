import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button, EmptyState } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { BulkGenerate } from '@/components/BulkGenerate'
import { ClassTiles } from '@/components/ClassTiles'
import { LibraryPanes } from '@/components/LibraryPanes'
import { NewLibraryItem } from '@/components/LibraryItemDialogs'
import { RememberClass } from '@/components/RememberClass'
import { aiStatus } from '@/lib/ai'
import { loadLibraryTree } from '@/lib/library'
import { roleCanEdit } from '@/lib/role'
import { pageAccount } from '@/lib/user'

export const dynamic = 'force-dynamic'

/**
 * Home: a signpost to classes, not the library tree. Whoever has the last
 * opened class remembered (`RememberClass`) is redirected straight to it —
 * the tiles show only for an empty library, the "All classes" path (`?vse=1`)
 * and for the moment before the client-side redirect kicks in.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ vse?: string; grade?: string }>
}) {
  const { vse: all, grade } = await searchParams
  // The old library address with the grade in the query (`/?grade=<id>`)
  // leads to its new class page — otherwise old links from the UI and those
  // saved in the browser would break. The class page itself checks it exists.
  if (grade) redirect(`/tridy/${encodeURIComponent(grade)}`)

  const account = await pageAccount()
  const tree = await loadLibraryTree(account)
  const canEdit = roleCanEdit(account.role)

  if (tree.length === 0) {
    // `LibraryPanes` omits the columns without a tree — an empty library gets
    // just this message across the whole area, not an empty sidebar.
    return (
      <EmptyState
        title={t('auth:home.emptyTitle')}
        hint={canEdit ? t('auth:home.emptyHintEditor') : t('auth:home.emptyHintViewer')}
        action={
          canEdit ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href="/import">
                <Button>{t('auth:home.bulkImport')}</Button>
              </Link>
              <NewLibraryItem kind="subject" label={t('auth:home.newSubject')} size="default" />
            </div>
          ) : undefined
        }
      />
    )
  }

  const knownGradeIds = tree.flatMap((subject) => subject.grades.map((grade) => grade.id))
  const totals = tree.reduce(
    (acc, subject) => {
      for (const grade of subject.grades) {
        for (const topic of grade.topics) {
          acc.topics += 1
          acc.questions += topic.questionCount
        }
      }
      return acc
    },
    { topics: 0, questions: 0 },
  )

  return (
    <LibraryPanes tree={tree} grade={null} contentLabel={t('auth:home.title')}>
      <div className="space-y-5">
        <RememberClass knownGradeIds={knownGradeIds} escape={all === '1'} userId={account.userId} />

        {/* Search across the whole library now lives in the sidebar (see
            `LibrarySidebar`) — two identical fields on one page would have a
            duplicated label and the second would target an invisible copy. */}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="ui-page-title">{t('auth:home.title')}</h1>
            <p className="mt-1 text-sm text-fg-soft">
              {t('auth:home.topics', { count: totals.topics })} · {t('auth:home.questions', { count: totals.questions })}
            </p>
          </div>
          {/* On a narrow screen the actions wrap instead of overflowing the
              header — `main` hides horizontal scrolling, so a button past the
              edge would be unreachable. */}
          <div className="flex flex-wrap items-center gap-2">
            {canEdit ? (
              <>
                <BulkGenerate
                  ai={aiStatus()}
                  // A subject's grammatical gender cannot be guessed from the folder
                  // name ("Celý MATEMATIKA"), so the button label carries no adjective.
                  scopes={tree.map((subject) => ({ label: t('auth:home.subjectScope', { name: subject.name }), subjectId: subject.id }))}
                />
                <NewLibraryItem kind="subject" label={t('auth:home.newSubject')} />
                <Link href="/import">
                  <Button size="sm" variant="outline">
                    {t('auth:home.bulkImport')}
                  </Button>
                </Link>
                <Link href="/tests/new">
                  <Button size="sm">{t('auth:home.newTest')}</Button>
                </Link>
              </>
            ) : null}
          </div>
        </div>

        <ClassTiles tree={tree} />
      </div>
    </LibraryPanes>
  )
}
