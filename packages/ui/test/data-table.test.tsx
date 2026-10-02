import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DataTable, type ColumnDef } from '../src/DataTable'

type Row = { id: string; name: string; count: number }
const rows: Row[] = [
  { id: 'a', name: 'Buňka', count: 3 },
  { id: 'b', name: 'Atom', count: 10 },
  { id: 'c', name: 'Cukr', count: 1 },
]
const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Název' },
  { accessorKey: 'count', header: 'Počet', meta: { numeric: true } },
]

const names = () =>
  within(screen.getAllByRole('rowgroup')[1]!)
    .getAllByRole('row')
    .map((row) => within(row).getAllByRole('cell')[0]!.textContent)

describe('DataTable', () => {
  it('keeps the given order until a header is clicked, then sorts by it', () => {
    render(<DataTable columns={columns} data={rows} getRowId={(row) => row.id} />)
    expect(names()).toEqual(['Buňka', 'Atom', 'Cukr'])

    fireEvent.click(screen.getByRole('button', { name: /Název/ }))
    expect(names()).toEqual(['Atom', 'Buňka', 'Cukr'])
    expect(screen.getByRole('columnheader', { name: /Název/ })).toHaveAttribute('aria-sort', 'ascending')
  })

  it('sorts numbers as numbers', () => {
    render(<DataTable columns={columns} data={rows} getRowId={(row) => row.id} />)
    fireEvent.click(screen.getByRole('button', { name: /Počet/ }))
    const counts = within(screen.getAllByRole('rowgroup')[1]!)
      .getAllByRole('row')
      .map((row) => within(row).getAllByRole('cell')[1]!.textContent)
    // Numbers start descending in TanStack — the biggest first.
    expect(counts).toEqual(['10', '3', '1'])
  })
})
