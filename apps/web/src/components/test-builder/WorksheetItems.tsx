'use client'

import {
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  type TableItemContent,
  type TemplateConfig,
  type TextItemVariant,
} from '@testmaker/core/schema'
import { Button } from '@testmaker/ui'

/** Rozměr v bodech papíru — stránka ve skladači se kreslí v měřítku PDF. */
const pt = (value: number) => `calc(${value} * var(--paper-pt, 1.3333px))`

/** Nová tabulka listu: dva sloupce, dva řádky, druhý sloupec k doplnění. */
export function emptyTable(): TableItemContent {
  return {
    caption: '',
    header: ['Pojem', 'Doplň'],
    rows: [
      [
        { value: '', blank: false },
        { value: '', blank: true },
      ],
      [
        { value: '', blank: false },
        { value: '', blank: true },
      ],
    ],
  }
}

/**
 * Krátký text, nebo fun fact v rámečku — upravuje se rovnou na papíře.
 * Rámeček kreslí tokeny papíru (`paper-line`, `paper-shade`), popisek bere
 * ze šablony, takže vypadá jako v PDF.
 */
export function TextItemEditor({
  text,
  variant,
  config,
  onChange,
}: {
  text: string
  variant: TextItemVariant
  config: TemplateConfig
  onChange: (text: string) => void
}) {
  const field = (
    <textarea
      className="block w-full resize-none bg-transparent text-paper-fg outline-none placeholder:opacity-40"
      style={{ fieldSizing: 'content' } as React.CSSProperties}
      rows={Math.max(1, Math.ceil(text.length / 90))}
      aria-label={variant === 'fun_fact' ? 'Text fun factu' : 'Krátký text'}
      placeholder={variant === 'fun_fact' ? 'Zajímavost k tématu' : 'Krátký text k tématu'}
      value={text}
      onChange={(event) => onChange(event.target.value)}
    />
  )
  if (variant === 'text') return <div style={{ marginTop: pt(8) }}>{field}</div>
  return (
    <div
      className={
        'text-paper-fg ' +
        (config.funFact.border ? 'border border-paper-fg ' : '') +
        (config.funFact.shaded ? 'bg-paper-shade' : '')
      }
      style={{ marginTop: pt(10), padding: pt(6) }}
    >
      {config.funFact.label ? <p className="font-bold">{config.funFact.label}</p> : null}
      {field}
    </div>
  )
}

/**
 * Tabulka k doplnění upravovaná na místě: buňky jsou políčka, u každé
 * buňky přepínač „prázdná na vyplnění“ (její text je pak odpověď do klíče),
 * řádky a sloupce se přidávají a ubírají v mezích schématu.
 */
export function TableItemEditor({ table, onChange }: { table: TableItemContent; onChange: (table: TableItemContent) => void }) {
  const columns = table.header.length

  function setHeader(index: number, value: string) {
    onChange({ ...table, header: table.header.map((title, i) => (i === index ? value : title)) })
  }
  function setCell(row: number, column: number, patch: Partial<{ value: string; blank: boolean }>) {
    onChange({
      ...table,
      rows: table.rows.map((cells, r) =>
        r === row ? cells.map((cell, c) => (c === column ? { ...cell, ...patch } : cell)) : cells,
      ),
    })
  }
  function addRow() {
    onChange({ ...table, rows: [...table.rows, table.header.map(() => ({ value: '', blank: false }))] })
  }
  function removeRow() {
    onChange({ ...table, rows: table.rows.slice(0, -1) })
  }
  function addColumn() {
    onChange({
      ...table,
      header: [...table.header, `Sloupec ${columns + 1}`],
      rows: table.rows.map((cells) => [...cells, { value: '', blank: true }]),
    })
  }
  function removeColumn() {
    onChange({ ...table, header: table.header.slice(0, -1), rows: table.rows.map((cells) => cells.slice(0, -1)) })
  }

  const hasBlank = table.rows.some((cells) => cells.some((cell) => cell.blank))
  const input = 'w-full bg-transparent outline-none placeholder:opacity-40'

  return (
    <div className="text-paper-fg" style={{ marginTop: pt(10) }}>
      <input
        className={`${input} font-bold`}
        aria-label="Popisek nad tabulkou"
        placeholder="Popisek nad tabulkou (nepovinné)"
        value={table.caption ?? ''}
        onChange={(event) => onChange({ ...table, caption: event.target.value })}
      />
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="bg-paper-shade">
            {table.header.map((title, c) => (
              <th key={c} className="border border-paper-line p-1 text-left">
                <input
                  className={`${input} font-bold`}
                  aria-label={`Název ${c + 1}. sloupce`}
                  value={title}
                  onChange={(event) => setHeader(c, event.target.value)}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((cells, r) => (
            <tr key={r}>
              {cells.map((cell, c) => (
                <td key={c} className="border border-paper-line p-1 align-top">
                  <input
                    className={`${input} ${cell.blank ? 'italic opacity-60' : ''}`}
                    aria-label={`Buňka ${r + 1}. řádku, ${c + 1}. sloupce`}
                    placeholder={cell.blank ? 'odpověď do klíče' : ''}
                    value={cell.value}
                    onChange={(event) => setCell(r, c, { value: event.target.value })}
                  />
                  <label className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
                    <input
                      type="checkbox"
                      checked={cell.blank}
                      onChange={(event) => setCell(r, c, { blank: event.target.checked })}
                    />
                    prázdná na vyplnění
                  </label>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 flex flex-wrap gap-1">
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={table.rows.length >= TABLE_MAX_ROWS} onClick={addRow}>
          + Řádek
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={table.rows.length <= 1} onClick={removeRow}>
          − Řádek
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={columns >= TABLE_MAX_COLUMNS} onClick={addColumn}>
          + Sloupec
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={columns <= 1} onClick={removeColumn}>
          − Sloupec
        </Button>
      </div>
      {!hasBlank ? (
        <p className="mt-1 text-xs text-danger">Označ aspoň jednu buňku jako prázdnou — jinak není co doplňovat.</p>
      ) : null}
    </div>
  )
}
