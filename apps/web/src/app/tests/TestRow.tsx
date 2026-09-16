'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2, MoreVertical } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  downloadPdf,
  printPdf,
} from '@testmaker/ui'

export interface TestRowData {
  id: string
  title: string
  graded: boolean
  variants: number
  questionCount: number
  points: number
  templateName: string
  updatedAt: string
}

/** Jeden řádek tabulky testů: přehled a akce (otevřít, stáhnout, smazat). */
export function TestRow({ row }: { row: TestRowData }) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Co se s testem právě děje. Nabídka se po kliknutí zavře, takže se stav
  // nemá kde ukázat v ní — ukazuje se místo tlačítka s třemi tečkami.
  const [pdfWork, setPdfWork] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)

  /** Vykreslení PDF trvá vteřiny; bez tohohle se po kliknutí zdánlivě nic nestalo. */
  async function withPdfWork(label: string, work: () => Promise<void>) {
    setPdfError(null)
    setPdfWork(label)
    try {
      await work()
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : String(error))
    } finally {
      setPdfWork(null)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      await fetch(`/api/tests?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      setConfirmOpen(false)
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <tr>
      <td className="py-2 pr-4">
        <Link href={`/tests/${row.id}`} className="font-medium text-fg hover:text-brand">
          {row.title}
        </Link>
        <div className="mt-1 flex flex-wrap gap-1">
          {row.graded ? <Badge>na známky</Badge> : <Badge variant="secondary">bez známek</Badge>}
          {row.variants === 2 ? <Badge variant="secondary">varianty A/B</Badge> : null}
        </div>
      </td>
      <td className="ui-numeric py-2 pr-4 text-fg-soft">{row.questionCount}</td>
      <td className="ui-numeric py-2 pr-4 text-fg-soft">{row.points}</td>
      <td className="py-2 pr-4 text-fg-soft">{row.templateName}</td>
      <td className="py-2 pr-4 text-fg-muted">
        {new Date(row.updatedAt).toLocaleDateString('cs')}
      </td>
      <td className="py-2 pr-0 text-right">
        {pdfWork ? (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-fg-soft"
          >
            <Loader2 className="size-3.5 animate-spin" />
            {pdfWork}
          </span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Akce">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/tests/${row.id}`}>Upravit</Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  void withPdfWork('Připravuji tisk…', () => printPdf(`/api/tests/${row.id}/pdf?variant=A`))
                }
              >
                Vytisknout
              </DropdownMenuItem>
              {/* Ne `<a target="_blank">`: prázdná záložka po dobu vykreslování
                  neřekne nic a původní stránka se tváří, že se nic nestalo.
                  Takhle se čeká tady, kde na to jde ukázat. */}
              <DropdownMenuItem
                onSelect={() =>
                  void withPdfWork('Připravuji PDF…', () => downloadPdf(`/api/tests/${row.id}/pdf?variant=A`))
                }
              >
                Stáhnout PDF
              </DropdownMenuItem>
              {row.variants === 2 ? (
                <DropdownMenuItem
                  onSelect={() =>
                    void withPdfWork('Připravuji PDF…', () =>
                      downloadPdf(`/api/tests/${row.id}/pdf?variant=B`),
                    )
                  }
                >
                  Stáhnout PDF, varianta B
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                variant="destructive"
                onSelect={(event) => {
                  event.preventDefault()
                  setConfirmOpen(true)
                }}
              >
                Smazat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {pdfError ? <p className="mt-1 text-sm text-danger">{pdfError}</p> : null}

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Smazat test „{row.title}“?</AlertDialogTitle>
              <AlertDialogDescription>
                Test se smaže včetně poskládaných položek. Otázky v bance zůstanou zachované.
                Akci nejde vrátit zpět.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Zrušit</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleting}
                aria-busy={deleting || undefined}
                onClick={(event) => {
                  event.preventDefault()
                  void remove()
                }}
              >
                {deleting ? 'Mažu…' : 'Smazat'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  )
}
