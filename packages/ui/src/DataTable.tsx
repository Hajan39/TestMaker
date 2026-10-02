'use client'

import {
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
  type ColumnDef as TanStackColumnDef,
  type RowData,
  type SortingState,
  type TableFeatures,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { t } from '@testmaker/core/i18n'
import { cn } from './cn'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

/** The table features every app table has: sorting by a column header. */
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns })
type Features = typeof features

/** A column of a `DataTable`; the value type differs per column. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ColumnDef<T extends RowData> = TanStackColumnDef<Features, T, any>
export type { SortingState }

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TFeatures extends TableFeatures, TData extends RowData, TValue> {
    /** Numbers are right-aligned in tabular figures. */
    numeric?: boolean
    /** Extra classes for the column's cells (header included). */
    className?: string
  }
}

/**
 * The app's one table, on TanStack Table: columns are described as data,
 * sorting by clicking a header comes for free, and every list looks the
 * same. Sorting is in the browser over the rows it is given — server-side
 * paging, if a list has it, stays the page's business.
 */
export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  initialSorting = [],
  rowClassName,
  className,
}: {
  columns: ColumnDef<T>[]
  data: T[]
  getRowId?: (row: T) => string
  initialSorting?: SortingState
  rowClassName?: (row: T) => string | undefined
  className?: string
}) {
  const table = useTable<Features, T>({
    features,
    columns,
    data,
    getRowId,
    initialState: { sorting: initialSorting },
  })

  return (
    <Table className={className}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="border-line-soft hover:bg-transparent">
            {group.headers.map((header) => {
              const meta = header.column.columnDef.meta
              const sorted = header.column.getIsSorted()
              const label = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())
              return (
                <TableHead
                  key={header.id}
                  aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  className={cn('h-auto py-2 pr-4 pl-0 font-medium text-fg-muted', meta?.numeric && 'text-right', meta?.className)}
                >
                  {header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn('inline-flex items-center gap-1 hover:text-fg', meta?.numeric && 'flex-row-reverse')}
                      title={t('ui:dataTable.sort')}
                    >
                      {label}
                      {sorted === 'asc' ? (
                        <ArrowUp className="size-3.5" aria-hidden />
                      ) : sorted === 'desc' ? (
                        <ArrowDown className="size-3.5" aria-hidden />
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-40" aria-hidden />
                      )}
                    </button>
                  ) : (
                    label
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody className="divide-y divide-line-soft [&_tr]:border-0">
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id} className={cn('hover:bg-transparent', rowClassName?.(row.original))}>
            {row.getAllCells().map((cell) => {
              const meta = cell.column.columnDef.meta
              return (
                <TableCell
                  key={cell.id}
                  className={cn('py-2 pr-4 pl-0 whitespace-normal', meta?.numeric && 'ui-numeric text-right', meta?.className)}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
