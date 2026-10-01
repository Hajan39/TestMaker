'use client'

import { useEffect, useRef, useState } from 'react'
import { t } from '@testmaker/core/i18n'
import { Delayed, LoadingPaper, cn } from '@testmaker/ui'

/**
 * Template preview as a real PDF page. The same renderer that produces the
 * final test draws it, so the preview never drifts from the result.
 *
 * Embedded via `iframe`, not `object`: Safari never fires the load event for
 * an `object` with a PDF, so the placeholder stayed on top of the finished
 * preview. Besides the event there is a timeout so the placeholder goes away
 * even when the browser reports nothing.
 */
export function TemplatePreview({
  templateId,
  graded = true,
  className,
  decorative = false,
}: {
  templateId: string
  graded?: boolean
  className?: string
  /**
   * Preview inside a button (template picker): the iframe would swallow the
   * click, so it cannot be focused or clicked and screen readers skip it.
   */
  decorative?: boolean
}) {
  const [ready, setReady] = useState(false)
  const timer = useRef<number | null>(null)
  const src = `/api/templates/${templateId}/preview${graded ? '' : '?graded=0'}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`

  useEffect(() => {
    timer.current = window.setTimeout(() => setReady(true), 2500)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  return (
    <div
      className={cn(
        'relative aspect-[210/297] w-full overflow-hidden rounded border border-line bg-paper',
        className,
      )}
    >
      {/*
        A page skeleton holds the place until the preview appears. No flicker:
        the skeleton is transparent for the first 400 ms (see `ui-delayed`), so
        it never shows for a preview the browser has cached.
      */}
      {!ready ? (
        <Delayed label={t('tests:templatePreview.loading')} className="absolute inset-0">
          <LoadingPaper />
        </Delayed>
      ) : null}
      <iframe
        src={src}
        title={t('tests:templatePreview.title')}
        className={cn('size-full', decorative && 'pointer-events-none')}
        tabIndex={decorative ? -1 : undefined}
        aria-hidden={decorative || undefined}
        loading="lazy"
        onLoad={() => setReady(true)}
      />
    </div>
  )
}
