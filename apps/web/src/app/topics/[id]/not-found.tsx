import Link from 'next/link'
import { Button, EmptyState } from '@testmaker/ui'

/**
 * Téma neexistuje. Typicky po jeho smazání nebo sloučení, kdy se učitelka vrátí
 * zpět v prohlížeči na starý odkaz — obecná hláška frameworku by ji nechala stát.
 */
export default function TopicNotFound() {
  return (
    <div className="p-5">
      <EmptyState
        title="Téma už neexistuje"
        hint="Nejspíš se smazalo nebo sloučilo s jiným. Najdeš ho přes jeho třídu."
        action={
          <Link href="/?vse=1">
            <Button>Všechny třídy</Button>
          </Link>
        }
      />
    </div>
  )
}
