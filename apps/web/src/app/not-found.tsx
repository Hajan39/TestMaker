import Link from 'next/link'
import { Button, EmptyState } from '@testmaker/ui'

/**
 * Obecná 404 pro adresy mimo témata a třídy (ty mají vlastní, konkrétnější
 * hlášku) — třeba překlep v adrese nebo starý odkaz na zrušenou stránku.
 */
export default function NotFound() {
  return (
    <div className="p-5">
      <EmptyState
        title="Stránka neexistuje"
        hint="Adresa je nejspíš neplatná nebo stránka mezitím zmizela."
        action={
          <Link href="/">
            <Button>Domů</Button>
          </Link>
        }
      />
    </div>
  )
}
