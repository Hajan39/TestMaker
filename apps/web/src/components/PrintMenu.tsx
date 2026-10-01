'use client'

import { Fragment, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  downloadPdf,
  printPdf,
  toast,
} from '@testmaker/ui'

/**
 * Tisk a stažení testu na jednom místě.
 *
 * Dřív se „Vytisknout" ve skladači a „Vytisknout" v seznamu testů chovaly
 * každé jinak: skladač přikládal klíč správných odpovědí (nastavení „Přiložit
 * klíč" bylo ve výchozím stavu zapnuté), seznam ho nepřikládal nikdy. Učitelka
 * podle popisku nepoznala, co jí z tiskárny vyleze — a v horším případě
 * rozdala dětem řešení.
 *
 * Proto jsou akce jen dvě a jmenují se podle toho, pro koho ten papír je:
 * **Zadání pro žáky** (bez klíče) a **Klíč pro mě** (s klíčem). Obojí jde
 * vytisknout i stáhnout, u varianty A i B. Obě místa v aplikaci berou tenhle
 * seznam odsud, aby se jim popisky nemohly znovu rozejít.
 */

/** Jedna položka nabídky: co se stane, jak se to jmenuje a co ukázat při čekání. */
export interface PrintAction {
  key: string
  label: string
  busyLabel: string
  run: () => Promise<void>
}

/** Adresa vykreslení PDF; `key=1` přiloží klíč správných odpovědí. */
function pdfHref(testId: string, variant: 'A' | 'B', withKey: boolean): string {
  return `/api/tests/${testId}/pdf?variant=${variant}${withKey ? '&key=1' : ''}`
}

/**
 * Akce rozdělené po variantách. U testu s jedinou variantou se varianta do
 * popisků nepíše (není z čeho vybírat); u dvou variant ano, aby byl každý
 * popisek jednoznačný.
 */
export function printGroups(testId: string, variants: number): { variant: 'A' | 'B'; actions: PrintAction[] }[] {
  const list: ('A' | 'B')[] = variants === 2 ? ['A', 'B'] : ['A']
  return list.map((variant) => {
    const suffix = variants === 2 ? `, varianta ${variant}` : ''
    return {
      variant,
      actions: [
        {
          key: `print-zadani-${variant}`,
          label: `Vytisknout zadání pro žáky${suffix}`,
          busyLabel: 'Připravuji tisk…',
          run: () => printPdf(pdfHref(testId, variant, false)),
        },
        {
          key: `print-klic-${variant}`,
          label: `Vytisknout klíč pro mě${suffix}`,
          busyLabel: 'Připravuji tisk…',
          run: () => printPdf(pdfHref(testId, variant, true)),
        },
        {
          key: `pdf-zadani-${variant}`,
          label: `Stáhnout zadání pro žáky${suffix}`,
          busyLabel: 'Připravuji PDF…',
          run: () => downloadPdf(pdfHref(testId, variant, false)),
        },
        {
          key: `pdf-klic-${variant}`,
          label: `Stáhnout klíč pro mě${suffix}`,
          busyLabel: 'Připravuji PDF…',
          run: () => downloadPdf(pdfHref(testId, variant, true)),
        },
      ],
    }
  })
}

/**
 * Položky do už existující rozbalovací nabídky (seznam testů má v téže nabídce
 * ještě Upravit a Smazat). Čekání a chybu si řeší volající — ví, kde je na ně
 * ve svém rozvržení místo.
 */
export function PrintMenuItems({
  testId,
  variants,
  disabled = false,
  onRun,
}: {
  testId: string
  variants: number
  disabled?: boolean
  onRun: (action: PrintAction) => void
}) {
  const groups = printGroups(testId, variants)
  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={group.variant}>
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {group.actions.map((action) => (
            <DropdownMenuItem key={action.key} disabled={disabled} onSelect={() => onRun(action)}>
              {action.label}
            </DropdownMenuItem>
          ))}
        </Fragment>
      ))}
    </>
  )
}

/**
 * Samostatná nabídka do lišty skladače — včetně čekání a chybové hlášky.
 *
 * PDF vzniká na serveru z uložené podoby. S neuloženými změnami by se
 * vytiskla starší verze, než jakou učitelka vidí — tisk proto počká na uložení.
 */
export function PrintMenu({ testId, variants, dirty = false }: { testId: string; variants: number; dirty?: boolean }) {
  // Vykreslení PDF trvá vteřiny; bez tohohle se po kliknutí zdánlivě nic nestalo.
  const [work, setWork] = useState<string | null>(null)

  function run(action: PrintAction) {
    setWork(action.busyLabel)
    void action
      .run()
      .catch((cause: unknown) => toast.error(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setWork(null))
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={work !== null} aria-busy={work !== null || undefined}>
            {work ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                {work}
              </>
            ) : (
              'Tisk a PDF'
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={dirty ? 'max-w-xs' : undefined}>
          {dirty ? (
            <DropdownMenuLabel className="text-xs font-normal text-fg-soft">
              Nejdřív ulož změny — tiskne se uložená podoba.
            </DropdownMenuLabel>
          ) : null}
          <PrintMenuItems testId={testId} variants={variants} disabled={dirty} onRun={run} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
