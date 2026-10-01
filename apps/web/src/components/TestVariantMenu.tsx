'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  plural,
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
  ai,
  dirty,
  onDirty,
}: {
  testId: string
  /** Stav generování ze stránky — bez modelu nabídka jen vysvětlí proč. */
  ai: { configured: boolean; problems: string[] }
  dirty: boolean
  /** Zavolá se, když je test rozpracovaný — verzi jde vytvořit až po uložení. */
  onDirty: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<TestVariantDirection | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // Server verzi dokončí i po zavření stránky, ale učitelka by o výsledku
  // nevěděla — proto se odchod během vytváření nejdřív ověří.
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  async function run(direction: TestVariantDirection) {
    if (dirty) {
      onDirty()
      return
    }
    setBusy(direction)
    setProgress(null)
    // Id kopie přichází hned v události `start`. Kdyby průběh spadl dřív než
    // `done` (server funkci po limitu ukončí, vypadne síť), kopie už existuje
    // a jen by osiřela — učitelka se na ni proto přesměruje s upozorněním.
    const konec: { kopie?: string; hotovo?: TestVariantEvent & { type: 'done' }; chyba?: string } = {}
    const otevriCastecnou = (kopie: string) => {
      // Déle než běžná hláška: přesměrování na kopii chvíli trvá a upozornění
      // nesmí zmizet dřív, než se stránka s kopií vůbec ukáže.
      toast.warning('Verze písemky je dokončená jen částečně — zkontroluj otázky.', { duration: 15_000 })
      router.push(`/tests/${kopie}`)
    }
    try {
      await createTestVariantStream(testId, direction, (event) => {
        if (event.type === 'start') {
          konec.kopie = event.testId
          setProgress({ done: 0, total: event.total })
        } else if (event.type === 'progress') setProgress({ done: event.done, total: event.total })
        else if (event.type === 'done') konec.hotovo = event
        else if (event.type === 'error') konec.chyba = event.message
      })

      if (konec.chyba) {
        toast.error(konec.chyba)
        if (konec.kopie) otevriCastecnou(konec.kopie)
        return
      }
      const hotovo = konec.hotovo
      if (!hotovo) {
        if (konec.kopie) otevriCastecnou(konec.kopie)
        else toast.error('Verzi písemky se nepodařilo vytvořit.')
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
        // Skloňování podle počtu: „1 otázka zůstala původní“, „3 otázky
        // zůstaly původní“, „5 otázek zůstalo původních“ — ne jen jednotné
        // a množné, čeština má u počtů tři tvary (`plural` v `@testmaker/ui`).
        toast.message(
          `${hotovo.kept} ${plural(
            hotovo.kept,
            'otázka zůstala původní',
            'otázky zůstaly původní',
            'otázek zůstalo původních',
          )}.`,
        )
      }
      router.push(`/tests/${hotovo.testId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Verzi písemky se nepodařilo vytvořit.')
      if (konec.kopie && !konec.hotovo) otevriCastecnou(konec.kopie)
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
      <DropdownMenuContent align="end" className={ai.configured ? undefined : 'max-w-xs'}>
        {/* Bez modelu verze vzniknout nemůže (vznikají i nové otázky), takže
            se místo pádu uprostřed průběhu hned řekne proč. */}
        {!ai.configured ? (
          <DropdownMenuLabel className="text-xs font-normal text-fg-soft">
            Verze písemky potřebuje generování, které není nastavené.
            {ai.problems.length > 0 ? ` ${ai.problems.join(' ')}` : ' Dej vědět správci, ať ho zapne.'}
          </DropdownMenuLabel>
        ) : null}
        {(['easier', 'harder'] as const).map((direction) => (
          <DropdownMenuItem key={direction} disabled={!ai.configured} onSelect={() => void run(direction)}>
            {SMER_LABEL[direction]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
