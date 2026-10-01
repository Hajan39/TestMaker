'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Button, EmptyState } from '@testmaker/ui'

/**
 * Když se stránka nepodaří načíst (typicky databáze nebo server), ukáže se
 * tohle místo anglické výchozí stránky Next.js. Lišta a navigace zůstávají,
 * takže učitelka může zkusit znovu, nebo odejít jinam.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="p-5">
      <EmptyState
        title="Stránku se nepodařilo načíst"
        hint={
          'Zkus to za chvíli znovu. Když to nepomůže, dej vědět správci' +
          (error.digest ? ` a pošli mu kód ${error.digest}.` : '.')
        }
        action={
          <div className="flex gap-2">
            <Button onClick={() => retry()}>Zkusit znovu</Button>
            <Link href="/">
              <Button variant="outline">Domů</Button>
            </Link>
          </div>
        }
      />
    </div>
  )
}
