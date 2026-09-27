'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from '@testmaker/ui'
import { createTestVariantStream, type TestVariantDirection, type TestVariantEvent } from '@/lib/generateClient'

const SMER_LABEL: Record<TestVariantDirection, string> = {
  easier: 'Lehčí verze písemky',
  harder: 'Těžší verze písemky',
}

/**
 * Vytvoří lehčí nebo těžší verzi celé uložené písemky — nabídka v hlavičce
 * skladače, vedle tisku.
 *
 * Verze vzniká vždy z toho, co je uložené, ne z rozpracované úpravy v
 * editoru: `onDirty` se zavolá místo požadavku, když jsou v testu neuložené
 * změny, a skladač na to reaguje vlastní hláškou (uložit se musí ručně).
 */
export function TestVariantMenu({
  testId,
  dirty,
  onDirty,
}: {
  testId: string
  dirty: boolean
  /** Zavolá se, když je test rozpracovaný — verzi jde vytvořit až po uložení. */
  onDirty: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<TestVariantDirection | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  async function run(direction: TestVariantDirection) {
    if (dirty) {
      onDirty()
      return
    }
    setBusy(direction)
    setProgress(null)
    try {
      const konec: { hotovo?: TestVariantEvent & { type: 'done' }; chyba?: string } = {}
      await createTestVariantStream(testId, direction, (event) => {
        if (event.type === 'start') setProgress({ done: 0, total: event.total })
        else if (event.type === 'progress') setProgress({ done: event.done, total: event.total })
        else if (event.type === 'done') konec.hotovo = event
        else if (event.type === 'error') konec.chyba = event.message
      })

      if (konec.chyba) {
        toast.error(konec.chyba)
        return
      }
      const hotovo = konec.hotovo
      if (!hotovo) {
        toast.error('Verzi písemky se nepodařilo vytvořit.')
        return
      }

      // Souhrn: co se vzalo z hotových verzí, co se vygenerovalo nově a kolik
      // otázek zůstalo, jaké byly — to poslední je pro učitelku nejdůležitější
      // zjištění, proto má vlastní větu, ne jen číslo v závorce.
      const vznikloDetail = [
        hotovo.replaced > 0 ? `${hotovo.replaced} z hotových verzí` : null,
        hotovo.generated > 0 ? `${hotovo.generated} nově vygenerováno` : null,
      ]
        .filter((cast): cast is string => Boolean(cast))
        .join(', ')
      toast.success(
        `${direction === 'easier' ? 'Lehčí' : 'Těžší'} verze písemky je hotová.` +
          (vznikloDetail ? ` ${vznikloDetail}.` : ''),
      )
      if (hotovo.kept > 0) {
        toast.message(`${hotovo.kept} ${hotovo.kept === 1 ? 'otázka zůstala' : 'otázek zůstalo'} původních.`)
      }
      router.push(`/tests/${hotovo.testId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Verzi písemky se nepodařilo vytvořit.')
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={busy !== null} aria-busy={busy !== null || undefined}>
          {busy ? (progress ? `Hotovo ${progress.done} z ${progress.total}` : 'Připravuji…') : 'Verze písemky'}
          {!busy ? <ChevronDown className="size-3.5" /> : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(['easier', 'harder'] as const).map((direction) => (
          <DropdownMenuItem key={direction} onSelect={() => void run(direction)}>
            {SMER_LABEL[direction]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
