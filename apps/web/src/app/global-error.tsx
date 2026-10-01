'use client'

import { useEffect } from 'react'

/**
 * Poslední záchrana, když selže i kořenový layout (načtení účtu nebo škol).
 * Nahrazuje celý dokument bez stylů aplikace, proto styly přímo tady.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="cs">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '15vh auto', padding: '0 16px' }}>
        <title>TestMaker – chyba</title>
        <h1 style={{ fontSize: 20 }}>Aplikaci se nepodařilo načíst</h1>
        <p style={{ lineHeight: 1.5 }}>
          Zkus to za chvíli znovu. Když to nepomůže, dej vědět správci
          {error.digest ? ` a pošli mu kód ${error.digest}.` : '.'}
        </p>
        <button type="button" onClick={() => retry()} style={{ padding: '8px 16px', fontSize: 14, cursor: 'pointer' }}>
          Zkusit znovu
        </button>
      </body>
    </html>
  )
}
