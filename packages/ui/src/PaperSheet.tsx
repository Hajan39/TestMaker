import type { ReactNode } from 'react'
import type { TemplateConfig, TestHeaderConfig } from '@testmaker/core/schema'
import { formatPoints } from '@testmaker/core/pdf/layout'
import { cn } from './cn'

/**
 * List papíru ve tvaru A4. Slouží skladači testu: učitelka skládá písemku
 * rovnou na stránce, na které ji uvidí i vytištěnou.
 *
 * Rozměry uvnitř listu se zapisují v bodech PDF (pt) přes proměnnou
 * `--paper-pt`. Ta se počítá z šířky samotného listu (`cqw`), takže se celá
 * stránka — písmo, okraje, linky — zmenšuje i zvětšuje v jednom měřítku a
 * poměry zůstávají stejné jako na papíře, ať je sloupec jakkoli široký.
 *
 * Papírové tokeny (`--color-paper`, `--color-paper-fg`, `--color-paper-line`)
 * se v tmavém režimu nemění: list zůstává světlý, protože ukazuje papír.
 */

/** Šířka A4 v bodech PDF (210 mm). */
const PAGE_WIDTH_PT = 595.28

/** Milimetry na body — táž převodní konstanta jako v `pdf/styles.ts`. */
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
  /** Levá část zápatí (název a varianta), jen když ho šablona tiskne. */
  footerLeft?: string
  /** Pravá část zápatí („strana 1 / 2“). */
  footerRight?: string
  className?: string
  bodyClassName?: string
}) {
  const ptValue = `calc(100cqw / ${PAGE_WIDTH_PT})`
  const pt = (value: number) => `calc(${value} * ${ptValue})`

  return (
    // Vnější obal je dotazovací kontejner: `cqw` uvnitř listu se počítá z jeho
    // šířky. Výšku A4 drží `min-height`, ne `aspect-ratio` — delší obsah, než
    // odhad čekal, se tak vysází pod sebe a nevyleze z listu ven.
    <div className="mx-auto w-full" style={{ containerType: 'inline-size' }}>
      <div
        data-slot="paper-sheet"
        className={cn(
          'flex w-full flex-col border border-paper-line bg-paper text-paper-fg shadow-sm',
          className,
        )}
        style={{
          // Odsud dolů platí `--paper-pt` a všechno se měří v bodech PDF.
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
        <div className={cn('min-w-0 flex-1', bodyClassName)}>{children}</div>
        {config.footer && (footerLeft || footerRight) ? (
          <div
            data-slot="paper-footer"
            className="flex shrink-0 justify-between gap-2 opacity-60"
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

/**
 * Hlavička testu tak, jak se vytiskne — název, políčko na body a známku,
 * popis, vyučující, linky k vyplnění a poznámka. Tiskne se jen na prvním
 * listu, proto ji `PaperSheet` nevykresluje sám a vkládá se jako obsah.
 *
 * Vzorem je `Header` v `pdf/TestDocument.tsx`.
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
            }}
          >
            {title
              ? config.header.title.uppercase
                ? title.toUpperCase()
                : title
              : 'Název písemky'}
            {variant === 'B' ? '  (varianta B)' : ''}
          </h3>
          {showScore ? (
            <div
              className="shrink-0 border border-paper-fg"
              style={{ width: pt(110), padding: pt(4), fontSize: pt(8) }}
            >
              <p>Body: ______ / {formatPoints(totalPoints)}</p>
              <p style={{ marginTop: pt(4) }}>Známka: ______</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {description ? (
        <p className="italic opacity-80" style={{ marginBottom: pt(6) }}>
          {description}
        </p>
      ) : null}

      {header.teacher ? <p style={{ marginBottom: pt(6) }}>Vyučující: {header.teacher}</p> : null}

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
          Poznámka: {header.note}
        </p>
      ) : null}

      {config.header.rule ? (
        <div className="border-b border-paper-fg" style={{ marginTop: pt(2) }} />
      ) : null}
    </div>
  )
}
