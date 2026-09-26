'use client'

import type { ReactNode } from 'react'
import { Loader2, MoreVertical } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@testmaker/ui'

/**
 * Jediný vzor akcí u řádku: tlačítko se třemi tečkami a v něm nabídka.
 *
 * Dřív měl každý seznam akce jinak — v bance dva textové odkazy vedle sebe
 * („Upravit" vypadalo stejně neškodně jako „Nahradit modelem", které přepíše
 * hotovou otázku), v seznamu testů nabídku pod třemi tečkami, v knihovně holé
 * ikony. Kliknout omylem na to, co přepisuje nebo maže, šlo jen v tom prvním
 * případě — proto vyhrála nabídka: ta se musí nejdřív otevřít a v ní je vidět
 * název akce i to, že je nevratná (červená položka).
 *
 * `busy` nahradí tlačítko popiskem toho, co se právě děje: nabídka se po
 * kliknutí zavře, takže čekání se nemá kde ukázat v ní.
 */
export function RowActions({
  label = 'Akce',
  busy = null,
  triggerRef,
  children,
}: {
  /** Popisek tlačítka pro čtečku obrazovky; u karet se hodí doplnit název položky. */
  label?: string
  busy?: string | null
  /**
   * Ref na samotné tlačítko. Nabídka po výběru „Upravit" sama vrátí ohnisko
   * sem — jenže otevře-li se editor (dialog) ve stejném tiku, tenhle krok mu
   * ukradne a po zavření dialogu (Escape) skončí ohnisko na `<body>`. Kdo
   * dialog otevírá, si přes ref tlačítko podrží a po zavření ho zaostří sám.
   */
  triggerRef?: React.Ref<HTMLButtonElement>
  children: ReactNode
}) {
  if (busy) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-fg-soft"
      >
        <Loader2 className="size-3.5 animate-spin" />
        {busy}
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button ref={triggerRef} size="icon-sm" variant="ghost" aria-label={label}>
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}
