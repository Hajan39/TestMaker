'use client'

import type { TestKind } from '@testmaker/core/schema'
import { useMatchesMedia } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'
import { TestCard, TestRow, type TestRowData } from './TestRow'

/**
 * The test list in two shapes: a table on a laptop, cards on a phone.
 *
 * Only one is ever rendered — both at once (one hidden via `hidden`) would mean
 * duplicated links and buttons for everything that walks the page, from
 * screen readers to tests.
 */
export function TestsTable({ kind, rows }: { kind: TestKind; rows: TestRowData[] }) {
  const phone = useMatchesMedia('(max-width: 639.98px)')

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
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line-soft text-fg-muted">
            <th className="py-2 pr-4 font-medium">{t('tests:table.name')}</th>
            {kind === 'pracovni_list' ? (
              <th className="py-2 pr-4 font-medium">{t('tests:table.items')}</th>
            ) : (
              <>
                <th className="py-2 pr-4 font-medium">{t('tests:table.questions')}</th>
                <th className="py-2 pr-4 font-medium">{t('tests:table.points')}</th>
              </>
            )}
            <th className="py-2 pr-4 font-medium">{t('tests:table.template')}</th>
            <th className="py-2 pr-4 font-medium">{t('tests:table.grade')}</th>
            <th className="py-2 pr-4 font-medium">{t('tests:table.changed')}</th>
            <th className="py-2 pr-0 font-medium text-right">{t('tests:table.actions')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">
          {rows.map((row) => (
            <TestRow key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
