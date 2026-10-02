import type { ReactNode } from 'react'
import type { TemplateConfig, TestHeaderConfig } from '@testmaker/core/schema'
import { decorationColor, decorationShapes, formatPoints, PAGE_HEIGHT } from '@testmaker/core/pdf/layout'
import { t } from '@testmaker/core/i18n'
import { cn } from './cn'

/**
 * An A4 sheet of paper. Used by the test composer: the teacher composes the
 * test right on the page she will see printed.
 *
 * Sizes inside the sheet are written in PDF points (pt) via the `--paper-pt`
 * variable. It is derived from the sheet's own width (`cqw`), so the whole
 * page — font, margins, lines — scales at one ratio and proportions match
 * paper, however wide the column is.
 *
 * Paper tokens (`--color-paper`, `--color-paper-fg`, `--color-paper-line`) do
 * not change in dark mode: the sheet stays light because it depicts paper.
 */

/** A4 width in PDF points (210 mm). */
const PAGE_WIDTH_PT = 595.28

/** Millimetres to points — the same conversion constant as in `pdf/styles.ts`. */
const mm = (value: number): number => value * 2.834645669

export function PaperSheet({
  config,
  children,
  footerLeft,
  footerRight,
  className,
  bodyClassName,
}: {
  config: TemplateConfig
  children: ReactNode
  /** Left part of the footer (title and variant), only when the template prints it. */
  footerLeft?: string
  /** Right part of the footer ("strana 1 / 2"). */
  footerRight?: string
  className?: string
  bodyClassName?: string
}) {
  const ptValue = `calc(100cqw / ${PAGE_WIDTH_PT})`
  const pt = (value: number) => `calc(${value} * ${ptValue})`

  return (
    // The outer wrapper is a query container: `cqw` inside the sheet is based on
    // its width. The A4 height is a `min-height`, not `aspect-ratio` — content
    // longer than estimated flows down instead of overflowing the sheet.
    <div className="mx-auto w-full" style={{ containerType: 'inline-size' }}>
      <div
        data-slot="paper-sheet"
        className={cn(
          'relative flex w-full flex-col overflow-hidden border border-paper-line bg-paper text-paper-fg shadow-sm',
          className,
        )}
        style={{
          // From here down `--paper-pt` applies and everything is in PDF points.
          ['--paper-pt' as string]: ptValue,
          minHeight: `calc(100cqw * 297 / 210)`,
          fontSize: pt(config.page.fontSize),
          lineHeight: config.page.lineHeight,
          fontFamily:
            config.page.fontFamily === 'NotoSerif'
              ? 'ui-serif, Georgia, "Times New Roman", serif'
              : 'ui-sans-serif, system-ui, sans-serif',
          paddingTop: pt(mm(config.page.marginTopMm)),
          paddingBottom: pt(mm(config.page.marginBottomMm)),
          paddingLeft: pt(mm(config.page.marginLeftMm)),
          paddingRight: pt(mm(config.page.marginRightMm)),
        }}
      >
        <PaperDecoration config={config} />
        <div className={cn('relative min-w-0 flex-1', bodyClassName)}>{children}</div>
        {config.footer && (footerLeft || footerRight) ? (
          <div
            data-slot="paper-footer"
            className="relative flex shrink-0 justify-between gap-2 opacity-60"
            style={{ fontSize: pt(8), paddingTop: pt(8) }}
          >
            <span className="truncate">{footerLeft}</span>
            <span className="shrink-0">{footerRight}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** The margin shapes of a playful template — the same list the PDF draws (`decorationShapes`). */
function PaperDecoration({ config }: { config: TemplateConfig }) {
  const shapes = decorationShapes(config.theme.decoration)
  if (shapes.length === 0) return null
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 w-full"
      viewBox={`0 0 ${PAGE_WIDTH_PT} ${PAGE_HEIGHT}`}
    >
      {shapes.map((shape, i) =>
        shape.kind === 'circle' ? (
          <circle key={i} cx={shape.cx} cy={shape.cy} r={shape.r} fill={decorationColor(config.theme, shape.tone)} />
        ) : (
          <path key={i} d={shape.d} fill={decorationColor(config.theme, shape.tone)} />
        ),
      )}
    </svg>
  )
}

/**
 * The test header as it prints — title, points and grade box, description,
 * teacher, lines to fill in and a note. Printed only on the first sheet, so
 * `PaperSheet` does not render it itself; it is passed as content.
 *
 * Modelled on `Header` in `pdf/TestDocument.tsx`.
 */
export function PaperHeader({
  title,
  description,
  header,
  config,
  graded,
  totalPoints,
  variant = 'A',
}: {
  title: string
  description?: string | null
  header: TestHeaderConfig
  config: TemplateConfig
  graded: boolean
  totalPoints: number
  variant?: 'A' | 'B'
}) {
  if (!config.header.show) return null
  const pt = (value: number) => `calc(${value} * var(--paper-pt, 1.3333px))`
  const showScore = config.header.scoreBox && graded
  const values: Record<string, string> = {
    school: header.school,
    subject: header.subject,
    class: header.className,
    teacher: header.teacher,
    date: header.date,
    name: '',
    note: header.note,
  }

  return (
    <div data-slot="paper-header" style={{ marginBottom: pt(12) }}>
      {config.header.title.show ? (
        <div className="flex items-start" style={{ marginBottom: pt(8) }}>
          <h3
            className={cn('flex-1 font-bold break-words', !title && 'opacity-40')}
            style={{
              fontSize: pt(config.header.title.fontSize),
              textAlign: config.header.title.align,
              // Template data like the PDF — the sheet stays paper in dark mode too.
              color: config.theme.accent,
            }}
          >
            {title
              ? config.header.title.uppercase
                ? title.toUpperCase()
                : title
              : t('ui:paper.header.titlePlaceholder')}
            {variant === 'B' ? `  ${t('ui:paper.header.variantB')}` : ''}
          </h3>
          {showScore ? (
            <div
              className="shrink-0 border border-paper-fg"
              style={{ width: pt(110), padding: pt(4), fontSize: pt(8) }}
            >
              <p>{t('ui:paper.header.points', { total: formatPoints(totalPoints) })}</p>
              <p style={{ marginTop: pt(4) }}>{t('ui:paper.header.grade')}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {description ? (
        <p className="italic opacity-80" style={{ marginBottom: pt(6) }}>
          {description}
        </p>
      ) : null}

      {header.teacher ? <p style={{ marginBottom: pt(6) }}>{t('ui:paper.header.teacher', { teacher: header.teacher })}</p> : null}

      <div className="flex flex-wrap">
        {config.header.fields.map((field) => {
          const value = field.value || values[field.key] || ''
          return (
            <div
              key={field.key}
              className="flex items-end"
              style={{ width: `${field.widthPercent}%`, marginBottom: pt(6), paddingRight: pt(10) }}
            >
              <span className="shrink-0">{field.label}:</span>
              {value ? (
                <span className="min-w-0 truncate" style={{ marginLeft: pt(4) }}>{value}</span>
              ) : (
                <span
                  className="flex-1 border-b border-paper-line"
                  style={{ marginLeft: pt(4), height: pt(12) }}
                />
              )}
            </div>
          )
        })}
      </div>

      {header.note ? (
        <p className="italic opacity-80" style={{ marginBottom: pt(6) }}>
          {t('ui:paper.header.note', { note: header.note })}
        </p>
      ) : null}

      {config.header.rule ? (
        <div className="border-b" style={{ marginTop: pt(2), borderColor: config.theme.accent }} />
      ) : null}
    </div>
  )
}
