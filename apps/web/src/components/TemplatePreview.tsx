'use client'

import { useState } from 'react'
import { cn } from '@testmaker/ui'

/**
 * Náhled šablony jako skutečná stránka PDF. Vykresluje ji tentýž renderer,
 * který vyrábí finální test, takže se náhled nikdy nerozejde s výsledkem.
 */
export function TemplatePreview({
  templateId,
  graded = true,
  className,
}: {
  templateId: string
  graded?: boolean
  className?: string
}) {
  const [loaded, setLoaded] = useState(false)
  const src = `/api/templates/${templateId}/preview${graded ? '' : '?graded=0'}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`

  return (
    <div
      className={cn(
        'relative aspect-[210/297] w-full overflow-hidden rounded border border-line bg-white',
        className,
      )}
    >
      {!loaded ? (
        <div className="absolute inset-0 animate-pulse bg-surface-muted" aria-hidden />
      ) : null}
      <object
        data={src}
        type="application/pdf"
        className="size-full"
        aria-label="Náhled šablony"
        onLoad={() => setLoaded(true)}
      >
        <div className="flex size-full items-center justify-center p-4 text-center text-sm text-fg-muted">
          Náhled se nezobrazil.{' '}
          <a href={src} target="_blank" rel="noreferrer" className="ml-1 text-brand underline">
            Otevřít PDF
          </a>
        </div>
      </object>
    </div>
  )
}
