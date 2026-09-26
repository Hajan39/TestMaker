'use client'

import { useMatchesMedia } from '@testmaker/ui'
import { TestCard, TestRow, type TestRowData } from './TestRow'

/**
 * Seznam testů ve dvou podobách: tabulka na notebooku, karty na telefonu.
 *
 * Vykresluje se vždy jen jedna — obě naráz (jedna schovaná přes `hidden`)
 * znamenají zdvojené odkazy i zdvojená tlačítka pro všechno, co stránku
 * prochází, od čtečky obrazovky po testy.
 */
export function TestsTable({ rows }: { rows: TestRowData[] }) {
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
            <th className="py-2 pr-4 font-medium">Název</th>
            <th className="py-2 pr-4 font-medium">Otázky</th>
            <th className="py-2 pr-4 font-medium">Body</th>
            <th className="py-2 pr-4 font-medium">Šablona</th>
            <th className="py-2 pr-4 font-medium">Třída</th>
            <th className="py-2 pr-4 font-medium">Změněno</th>
            <th className="py-2 pr-0 font-medium text-right">Akce</th>
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
