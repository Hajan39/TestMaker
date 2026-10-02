'use client'

import { useMemo } from 'react'
import { DataTable, type ColumnDef } from '@testmaker/ui'

type Value = string | number
type ValueRow = { id: string; cells: Value[] }

/**
 * A table of plain values for an overview page rendered on the server: the
 * page passes only a header and rows (serialisable), the columns — with
 * sorting — are built here in the browser. The first column is the label,
 * numbers are right-aligned and formatted in Czech.
 */
export function ValueTable({ header, rows }: { header: string[]; rows: Value[][] }) {
  const columns = useMemo<ColumnDef<ValueRow>[]>(
    () =>
      header.map((name, i) => ({
        id: `c${i}`,
        header: name,
        accessorFn: (row) => row.cells[i],
        cell: ({ getValue }) => {
          const value = getValue() as Value
          return typeof value === 'number' ? value.toLocaleString('cs-CZ') : value
        },
        meta: i === 0 ? { className: 'text-fg' } : { numeric: true },
      })),
    [header],
  )
  const data = useMemo(() => rows.map((cells, i) => ({ id: `${i}:${String(cells[0])}`, cells })), [rows])
  return <DataTable columns={columns} data={data} getRowId={(row) => row.id} />
}
