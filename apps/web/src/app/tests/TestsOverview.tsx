import { and, asc, desc, eq, sql } from 'drizzle-orm'
import Link from 'next/link'
import type { TestKind } from '@testmaker/core/schema'
import { t } from '@testmaker/core/i18n'
import { Button, Card, EmptyState, PageShell } from '@testmaker/ui'
import { db, grades, questions, subjects, templates, testItems, tests, topics } from '@/db'
import { loadTestGradeOptions, testConditions } from '@/lib/tests'
import { inSchool, pageAccount } from '@/lib/user'
import { TestsTable } from './TestsTable'
import { TestsFilters } from './TestsFilters'
import { overviewPath } from './paths'
import { KindMark } from '@/components/KindMark'

/** How many items to show at once before offering more. */
const PAGE_SIZE = 25

export interface OverviewParams {
  q?: string
  templateId?: string
  trida?: string
  limit?: string
}

/** Texts in which the test overview and the worksheet overview differ. */
function overviewTexts(kind: TestKind) {
  return kind === 'pracovni_list'
    ? {
        title: t('worksheets:overview.title'),
        add: t('worksheets:overview.add'),
        emptyTitle: t('worksheets:overview.emptyTitle'),
        emptyHint: t('worksheets:overview.emptyHint'),
        create: t('worksheets:overview.create'),
      }
    : {
        title: t('tests:overview.title'),
        add: t('tests:overview.add'),
        emptyTitle: t('tests:overview.emptyTitle'),
        emptyHint: t('tests:overview.emptyHint'),
        create: t('tests:overview.create'),
      }
}

/**
 * Overview of written tests or worksheets — own ones and those shared in the
 * school, with search and a grade filter. Both overviews are the same list,
 * just with a different kind (`tests.kind`).
 */
export async function TestsOverview({ kind, params }: { kind: TestKind; params: OverviewParams }) {
  const text = overviewTexts(kind)
  const basePath = overviewPath(kind)
  const search = params.q ?? ''
  const templateId = params.templateId ?? ''
  const limit = Math.min(Math.max(Number(params.limit) || PAGE_SIZE, PAGE_SIZE), 500)

  const account = await pageAccount()
  const gradeOptions = await loadTestGradeOptions(account, kind)
  // A foreign or stale grade from a link behaves as "Všechny ročníky" (all
  // grades), not as a filter nothing matches.
  const grade = params.trida && gradeOptions.some((grade) => grade.id === params.trida) ? params.trida : ''

  const conditions = testConditions(account, {
    search,
    templateId: templateId || undefined,
    gradeId: grade || undefined,
    kind,
  })
  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [rows, [totalRow], templateRows] = await Promise.all([
    db
      .select({
        id: tests.id,
        kind: tests.kind,
        title: tests.title,
        graded: tests.graded,
        variants: tests.variants,
        updatedAt: tests.updatedAt,
        templateName: templates.name,
        // Empty for a test without a grade — the `left join` on `grades`/`subjects`
        // yields only `null` in that case.
        gradeLabel: sql<string | null>`
          case when ${grades.id} is not null then ${subjects.name} || ' · ' || ${grades.name} else null end
        `,
        // The worksheet topic; a deleted topic becomes empty and the worksheet shows as free-form.
        topicName: topics.name,
        // A colleague's shared test can be opened and copied, not edited or deleted.
        mine: sql<boolean>`${tests.ownerId} = ${account.userId}`.mapWith(Boolean),
        questionCount: sql<number>`(
          select count(*) from ${testItems}
          where ${testItems.testId} = ${tests.id} and ${testItems.kind} = 'question'
        )`,
        itemCount: sql<number>`(
          select count(*) from ${testItems}
          where ${testItems.testId} = ${tests.id} and ${testItems.kind} != 'page_break'
        )`,
        // Points as in the editor and the PDF: the frozen question snapshot wins,
        // the live bank question only where the snapshot is missing. Broken JSON
        // would make `json_extract` fail the whole query, hence `json_valid` first.
        points: sql<number>`(
          select coalesce(sum(coalesce(
            ${testItems.pointsOverride},
            case when json_valid(${testItems.questionSnapshot})
              then json_extract(${testItems.questionSnapshot}, '$.points') end,
            ${questions.points}
          )), 0)
          from ${testItems}
          left join ${questions} on ${questions.id} = ${testItems.questionId}
          where ${testItems.testId} = ${tests.id} and ${testItems.kind} = 'question'
        )`,
      })
      .from(tests)
      .innerJoin(templates, eq(templates.id, tests.templateId))
      .leftJoin(grades, eq(grades.id, tests.gradeId))
      .leftJoin(subjects, eq(subjects.id, grades.subjectId))
      .leftJoin(topics, eq(topics.id, tests.topicId))
      .where(where)
      .orderBy(desc(tests.updatedAt))
      .limit(limit),
    db
      .select({ value: sql<number>`count(*)` })
      .from(tests)
      .innerJoin(templates, eq(templates.id, tests.templateId))
      .where(where),
    db
      .select({ id: templates.id, name: templates.name, config: templates.config })
      .from(templates)
      .where(inSchool(account, templates))
      .orderBy(asc(templates.name)),
  ])

  // Only templates of this overview's kind — a worksheet template means nothing
  // in the test filter. A template picked earlier (from a link) stays on offer.
  // Older stored configs have no `kind`; the schema reads them as a test.
  const templateOptions = templateRows
    .filter((row) => (row.config.kind ?? 'pisemka') === kind || row.id === templateId)
    .map(({ id, name }) => ({ id, name }))

  const total = Number(totalRow?.value ?? 0)
  const filtered = Boolean(search.trim()) || Boolean(templateId) || Boolean(grade)

  /** Link to the same page with a higher limit — the server fetches more items. */
  const moreParams = new URLSearchParams()
  if (search.trim()) moreParams.set('q', search.trim())
  if (templateId) moreParams.set('templateId', templateId)
  if (grade) moreParams.set('trida', grade)
  moreParams.set('limit', String(limit + PAGE_SIZE))

  return (
    <PageShell>
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="ui-page-title flex items-center gap-2">
            <KindMark kind={kind} />
            {text.title} ({total})
          </h1>
          <Button asChild>
            <Link href={`${basePath}/new`}>{text.add}</Link>
          </Button>
        </div>

        {total === 0 && !filtered ? (
          <EmptyState
            title={text.emptyTitle}
            hint={text.emptyHint}
            action={
              <Button asChild>
                <Link href={`${basePath}/new`}>{text.create}</Link>
              </Button>
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <TestsFilters
              kind={kind}
              basePath={basePath}
              search={search}
              templateId={templateId}
              templates={templateOptions}
              gradeId={grade}
              grades={gradeOptions}
            />

            {rows.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title={t('tests:overview.noMatch.title')}
                  hint={t('tests:overview.noMatch.hint')}
                  action={
                    <Button asChild variant="outline">
                      <Link href={basePath}>{t('tests:overview.noMatch.clear')}</Link>
                    </Button>
                  }
                />
              </div>
            ) : (
              <TestsTable kind={kind} rows={rows} />
            )}

            {total > rows.length ? (
              <div className="mt-3 flex justify-center">
                <Button asChild variant="outline">
                  <Link href={`${basePath}?${moreParams.toString()}`} scroll={false}>
                    {t('tests:overview.loadMore', { count: total - rows.length })}
                  </Link>
                </Button>
              </div>
            ) : null}
          </Card>
        )}
      </div>
    </PageShell>
  )
}
