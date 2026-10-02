'use client'

import {
  DEFAULT_THEME,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
  type TableItemContent,
  type TemplateConfig,
  type TextItemVariant,
} from '@testmaker/core/schema'
import { Button } from '@testmaker/ui'
import { t } from '@testmaker/core/i18n'

/** Size in paper points — the builder page is drawn at PDF scale. */
const pt = (value: number) => `calc(${value} * var(--paper-pt, 1.3333px))`

/** New worksheet table: two columns, two rows, the second column to fill in. */
export function emptyTable(): TableItemContent {
  return {
    caption: '',
    header: [t('worksheets:table.defaultTerm'), t('worksheets:table.defaultFill')],
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
 * A short text or a boxed fun fact — edited right on the paper. The box uses
 * paper tokens (`paper-line`, `paper-shade`) and takes its label from the
 * template, so it looks like the PDF.
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
      aria-label={variant === 'fun_fact' ? t('worksheets:text.funFactLabel') : t('worksheets:text.textLabel')}
      placeholder={variant === 'fun_fact' ? t('worksheets:text.funFactPlaceholder') : t('worksheets:text.textPlaceholder')}
      value={text}
      onChange={(event) => onChange(event.target.value)}
    />
  )
  if (variant === 'text') return <div style={{ marginTop: pt(8) }}>{field}</div>
  return (
    <div
      className={'text-paper-fg ' + (config.funFact.border ? 'border border-paper-fg ' : '')}
      style={{
        marginTop: pt(10),
        padding: pt(6),
        borderRadius: pt(config.theme.radius),
        // Template colours, as the PDF prints them (`TextBlock`).
        borderColor: config.theme.accent === DEFAULT_THEME.accent ? undefined : config.theme.accent,
        backgroundColor: config.funFact.shaded ? config.theme.accentSoft : undefined,
      }}
    >
      {config.funFact.label ? (
        <p className="font-bold" style={{ color: config.theme.accent === DEFAULT_THEME.accent ? undefined : config.theme.accent }}>
          {config.funFact.label}
        </p>
      ) : null}
      {field}
    </div>
  )
}

/**
 * Fill-in table edited in place: cells are inputs, each with a "prázdná na
 * vyplnění" (blank to fill in) toggle (its text is then the key answer); rows
 * and columns are added and removed within the schema limits.
 */
export function TableItemEditor({
  table,
  shade,
  onChange,
}: {
  table: TableItemContent
  /** Header fill from the template (`theme.accentSoft`). */
  shade?: string
  onChange: (table: TableItemContent) => void
}) {
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
      header: [...table.header, t('worksheets:table.defaultColumn', { number: columns + 1 })],
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
        aria-label={t('worksheets:table.caption')}
        placeholder={t('worksheets:table.captionPlaceholder')}
        value={table.caption ?? ''}
        onChange={(event) => onChange({ ...table, caption: event.target.value })}
      />
      <table className="w-full table-fixed border-collapse">
        <thead>
          <tr className="bg-paper-shade" style={shade ? { backgroundColor: shade } : undefined}>
            {table.header.map((title, c) => (
              <th key={c} className="border border-paper-line p-1 text-left">
                <input
                  className={`${input} font-bold`}
                  aria-label={t('worksheets:table.columnName', { column: c + 1 })}
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
                    aria-label={t('worksheets:table.cell', { row: r + 1, column: c + 1 })}
                    placeholder={cell.blank ? t('worksheets:table.keyAnswer') : ''}
                    value={cell.value}
                    onChange={(event) => setCell(r, c, { value: event.target.value })}
                  />
                  <label className="mt-0.5 flex items-center gap-1 text-xs text-fg-muted">
                    <input
                      type="checkbox"
                      checked={cell.blank}
                      onChange={(event) => setCell(r, c, { blank: event.target.checked })}
                    />
                    {t('worksheets:table.blank')}
                  </label>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 flex flex-wrap gap-1">
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={table.rows.length >= TABLE_MAX_ROWS} onClick={addRow}>
          {t('worksheets:table.addRow')}
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={table.rows.length <= 1} onClick={removeRow}>
          {t('worksheets:table.removeRow')}
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={columns >= TABLE_MAX_COLUMNS} onClick={addColumn}>
          {t('worksheets:table.addColumn')}
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={columns <= 1} onClick={removeColumn}>
          {t('worksheets:table.removeColumn')}
        </Button>
      </div>
      {!hasBlank ? (
        <p className="mt-1 text-xs text-danger">{t('worksheets:table.noBlank')}</p>
      ) : null}
    </div>
  )
}
