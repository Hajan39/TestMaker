'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import type { TestKind } from '@testmaker/core/schema'
import { formatDate } from '@testmaker/core/dates'
import { DataTable, useMatchesMedia, type ColumnDef } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { KindMark } from '@/components/KindMark'
import { testPath } from './paths'
import { TestActions, TestBadges, TestCard, type TestRowData } from './TestRow'

/** Columns of the list; a worksheet has items instead of questions and points. */
function columnsFor(kind: TestKind): ColumnDef<TestRowData>[] {
  const counts: ColumnDef<TestRowData>[] =
    kind === 'pracovni_list'
      ? [{ accessorKey: 'itemCount', header: () => t('tests:table.items'), meta: { numeric: true } }]
      : [
          { accessorKey: 'questionCount', header: () => t('tests:table.questions'), meta: { numeric: true } },
          { accessorKey: 'points', header: () => t('tests:table.points'), meta: { numeric: true } },
        ]
  return [
    {
      accessorKey: 'title',
      header: () => t('tests:table.name'),
      cell: ({ row }) => (
        <div className={row.original.kind === 'pracovni_list' ? 'border-l-2 border-worksheet pl-2' : undefined}>
          <Link
            href={testPath(row.original.kind, row.original.id)}
            className="inline-flex items-center gap-1.5 font-medium text-fg hover:text-brand"
          >
            <KindMark kind={row.original.kind} />
            {row.original.title}
          </Link>
          <TestBadges row={row.original} />
        </div>
      ),
    },
    ...counts,
    { accessorKey: 'templateName', header: () => t('tests:table.template'), meta: { className: 'text-fg-soft' } },
    {
      accessorKey: 'gradeLabel',
      header: () => t('tests:table.grade'),
      cell: ({ row }) => row.original.gradeLabel ?? '',
      meta: { className: 'text-fg-soft' },
    },
    {
      accessorKey: 'updatedAt',
      header: () => t('tests:table.changed'),
      cell: ({ row }) => formatDate(row.original.updatedAt),
      meta: { className: 'text-fg-muted' },
    },
    {
      id: 'actions',
      header: () => t('tests:table.actions'),
      cell: ({ row }) => <TestActions row={row.original} />,
      enableSorting: false,
      meta: { className: 'pr-0 text-right' },
    },
  ]
}

/**
 * The test list in two shapes: a table on a laptop, cards on a phone.
 *
 * Only one is ever rendered — both at once (one hidden via `hidden`) would mean
 * duplicated links and buttons for everything that walks the page, from
 * screen readers to tests.
 */
export function TestsTable({ kind, rows }: { kind: TestKind; rows: TestRowData[] }) {
  const phone = useMatchesMedia('(max-width: 639.98px)')
  const columns = useMemo(() => columnsFor(kind), [kind])

  if (phone) {
    return (
      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <TestCard key={row.id} row={row} />
        ))}
      </ul>
    )
  }

  return (
    <div className="mt-3">
      <DataTable columns={columns} data={rows} getRowId={(row) => row.id} />
    </div>
  )
}
