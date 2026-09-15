'use client'

import type { ResolvedTestItem, Template } from '@testmaker/core/schema'
import { paginate } from '@testmaker/core/pdf/estimate'
import { useMemo } from 'react'
import type { DraftItem } from './types'

/**
 * Hrubý náhled testu poskládaný přímo v prohlížeči ze stejných dat jako PDF —
 * nevolá server. Slouží k odhadu, kolik stran test zabere a jak se rozloží,
 * ne k přesnému náhledu typografie.
 */
export function RoughPreview({
  items,
  template,
  graded,
  title,
}: {
  items: DraftItem[]
  template: Template
  graded: boolean
  title: string
}) {
  const pages = useMemo(() => {
    const resolved: ResolvedTestItem[] = items.map((item, index) => ({
      id: item.key,
      testId: 'draft',
      order: index,
      kind: item.kind,
      questionId: item.questionId,
      text: item.text,
      pointsOverride: item.pointsOverride,
      linesOverride: item.linesOverride,
      question: item.question,
    }))
    return paginate(resolved, template.config)
  }, [items, template])

  return (
    <div className="flex h-full flex-col">
      <h2 className="shrink-0 text-sm font-semibold text-fg">Náhled</h2>
      <p className="mt-1 shrink-0 text-sm text-fg-muted">
        Hrubé rozvržení stran — přesné PDF stáhneš tlačítkem nahoře.
      </p>
      <div className="mt-3 min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {pages.map((page, pageIndex) => (
          <div
            key={pageIndex}
            className="mx-auto aspect-[210/297] w-full max-w-64 rounded-sm border border-paper-line bg-paper p-3 text-[7px] leading-tight text-paper-fg shadow-sm"
          >
            {pageIndex === 0 ? (
              <p className="mb-2 text-center text-[9px] font-semibold">{title || 'Nový test'}</p>
            ) : null}
            <div className="space-y-1.5">
              {page.map((item) => (
                <PreviewItem key={item.id} item={item} graded={graded} />
              ))}
            </div>
            <p className="mt-2 text-center text-[6px] text-fg-muted">strana {pageIndex + 1} / {pages.length}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function PreviewItem({ item, graded }: { item: ResolvedTestItem; graded: boolean }) {
  if (item.kind === 'heading') {
    return <p className="border-b border-line pb-0.5 font-semibold uppercase">{item.text}</p>
  }

  if (item.kind === 'instruction') {
    return <p className="italic text-fg-muted">{item.text}</p>
  }

  if (item.kind === 'page_break' || !item.question) return null

  const question = item.question
  const points = item.pointsOverride ?? question.points

  return (
    <div>
      <p className="line-clamp-2">
        {question.payload.prompt ?? ''} {graded ? <span className="text-fg-muted">({points} b.)</span> : null}
      </p>
      <AnswerHint type={question.type} />
    </div>
  )
}

/** Naznačí tvar odpovědi bez toho, aby přesně kopíroval typografii PDF. */
function AnswerHint({ type }: { type: string }) {
  switch (type) {
    case 'open':
      return (
        <div className="mt-0.5 space-y-1">
          <div className="h-px bg-line" />
          <div className="h-px bg-line" />
        </div>
      )
    case 'single_choice':
    case 'multi_choice':
    case 'true_false':
    case 'table_fill':
    case 'matching':
    case 'ordering':
    case 'fill_blank':
      return (
        <div className="mt-0.5 grid grid-cols-2 gap-x-2 gap-y-0.5">
          <div className="h-1 rounded-sm bg-line-soft" />
          <div className="h-1 rounded-sm bg-line-soft" />
        </div>
      )
    default:
      return <div className="mt-0.5 h-px w-1/2 bg-line" />
  }
}
