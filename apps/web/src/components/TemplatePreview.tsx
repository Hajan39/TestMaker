'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@testmaker/ui'

/**
 * Náhled šablony jako skutečná stránka PDF. Vykresluje ji tentýž renderer,
 * který vyrábí finální test, takže se náhled nikdy nerozejde s výsledkem.
 *
 * Vloženo přes `iframe`, ne `object`: Safari u `object` s PDF událost o načtení
 * nespustí, takže zástupná plocha zůstala navrchu a překrývala hotový náhled.
 * Kromě události je tu i časový strop, aby se plocha uklidila i tehdy, když
 * prohlížeč neohlásí nic.
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
        'relative aspect-[210/297] w-full overflow-hidden rounded border border-line bg-white',
        className,
      )}
    >
      {/* Klidná plocha, ne pulzující — než se náhled objeví, nemá to blikat. */}
      {!ready ? <div className="absolute inset-0 bg-surface-muted" aria-hidden /> : null}
      <iframe
        src={src}
        title="Náhled šablony"
        className="size-full"
        loading="lazy"
        onLoad={() => setReady(true)}
      />
    </div>
  )
}
