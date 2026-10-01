'use client'

import { useEffect, useRef, useState } from 'react'
import { Delayed, LoadingPaper, cn } from '@testmaker/ui'

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
  decorative = false,
}: {
  templateId: string
  graded?: boolean
  className?: string
  /**
   * Náhled uvnitř tlačítka (výběr šablony): iframe by klik spolkl a tlačítko
   * by nereagovalo, proto se nedá zaměřit ani kliknout a čtečka ho přeskočí.
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
        Než se náhled objeví, drží jeho místo kostra stránky. Blikání hrozit
        nemůže: kostra je prvních 400 ms průhledná (viz `ui-delayed`), takže
        u náhledu, který má prohlížeč v mezipaměti, se vůbec neukáže.
      */}
      {!ready ? (
        <Delayed label="Připravuji náhled šablony…" className="absolute inset-0">
          <LoadingPaper />
        </Delayed>
      ) : null}
      <iframe
        src={src}
        title="Náhled šablony"
        className={cn('size-full', decorative && 'pointer-events-none')}
        tabIndex={decorative ? -1 : undefined}
        aria-hidden={decorative || undefined}
        loading="lazy"
        onLoad={() => setReady(true)}
      />
    </div>
  )
}
