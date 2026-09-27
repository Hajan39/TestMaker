import Link from 'next/link'
import { Button, EmptyState } from '@testmaker/ui'

/**
 * Třída neexistuje. Typicky po jejím smazání, kdy se učitelka vrátí zpět
 * v prohlížeči na starý odkaz, nebo si na ni pamatuje `RememberClass` z
 * dřívějška — obecná hláška frameworku by ji nechala stát.
 */
export default function ClassNotFound() {
  return (
    <div className="p-5">
      <EmptyState
        title="Třída už neexistuje"
        hint="Nejspíš se smazala. Vyber si jinou na úvodní obrazovce."
        action={
          <Link href="/?vse=1">
            <Button>Všechny třídy</Button>
          </Link>
        }
      />
    </div>
  )
}
