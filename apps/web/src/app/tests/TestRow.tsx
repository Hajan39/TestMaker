'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  DropdownMenuItem,
  toast,
} from '@testmaker/ui'
import { PrintMenuItems } from '@/components/PrintMenu'
import { RowActions } from '@/components/RowActions'

export interface TestRowData {
  id: string
  title: string
  graded: boolean
  variants: number
  questionCount: number
  points: number
  templateName: string
  /** „Předmět · ročník"; `null` u testu bez třídy. */
  gradeLabel: string | null
  updatedAt: string
}

/**
 * Akce u jednoho testu: nabídka pod třemi tečkami — týž vzor jako u otázek
 * v bance. Mazání je v ní, červeně a s potvrzením; omylem se na ně kliknout nedá.
 */
function TestActions({ row }: { row: TestRowData }) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copying, setCopying] = useState(false)
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

  /**
   * Kopie testu. Loňskou písemku chce učitelka použít znovu, ne přepsat —
   * kopie si bere i zmrazené znění otázek, takže vypadá přesně jako originál,
   * i kdyby se otázky v bance mezitím změnily.
   */
  async function copy() {
    setCopying(true)
    try {
      const response = await fetch(`/api/tests?copyOf=${encodeURIComponent(row.id)}`, { method: 'POST' })
      const data = (await response.json()) as { id?: string; error?: string }
      if (!response.ok || !data.id) {
        toast.error(data.error ?? 'Kopii se nepodařilo vytvořit')
        return
      }
      router.refresh()
      toast.success(`Kopie „${row.title} (kopie)“ je hotová.`, {
        duration: 10_000,
        action: { label: 'Otevřít', onClick: () => router.push(`/tests/${data.id}`) },
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Kopii se nepodařilo vytvořit')
    } finally {
      setCopying(false)
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
    <>
      <RowActions label={`Akce u testu ${row.title}`} busy={pdfWork ?? (copying ? 'Kopíruji…' : null)}>
        <DropdownMenuItem asChild>
          <Link href={`/tests/${row.id}`}>Upravit</Link>
        </DropdownMenuItem>
        {/* Nabídka se po kliknutí zavře — že se kopíruje, je vidět
            místo tlačítka s třemi tečkami, stejně jako u tisku. */}
        <DropdownMenuItem onSelect={() => void copy()}>Vytvořit kopii</DropdownMenuItem>
        {/* Tisk i stažení berou popisky ze sdílené nabídky — aby se
            seznam testů a skladač nemohly rozejít v tom, co „Vytisknout"
            vlastně udělá s klíčem správných odpovědí. */}
        <PrintMenuItems
          testId={row.id}
          variants={row.variants}
          onRun={(action) => void withPdfWork(action.busyLabel, action.run)}
        />
        <DropdownMenuItem
          variant="destructive"
          onSelect={(event) => {
            event.preventDefault()
            setConfirmOpen(true)
          }}
        >
          Smazat
        </DropdownMenuItem>
      </RowActions>
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
    </>
  )
}

/** Skloňování počtu otázek: 1 otázka, 2–4 otázky, 5 a víc otázek. */
function otazkyWord(count: number): string {
  if (count === 1) return 'otázka'
  if (count < 5) return 'otázky'
  return 'otázek'
}

/** Odznáčky testu: na známky / bez známek, případně varianty A/B. */
function TestBadges({ row }: { row: TestRowData }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {row.graded ? <Badge variant="status">na známky</Badge> : <Badge variant="secondary">bez známek</Badge>}
      {row.variants === 2 ? <Badge variant="secondary">varianty A/B</Badge> : null}
    </div>
  )
}

/** Jeden řádek tabulky testů: přehled a akce (otevřít, stáhnout, smazat). */
export function TestRow({ row }: { row: TestRowData }) {
  return (
    <tr>
      <td className="py-2 pr-4">
        <Link href={`/tests/${row.id}`} className="font-medium text-fg hover:text-brand">
          {row.title}
        </Link>
        <TestBadges row={row} />
      </td>
      <td className="ui-numeric py-2 pr-4 text-fg-soft">{row.questionCount}</td>
      <td className="ui-numeric py-2 pr-4 text-fg-soft">{row.points}</td>
      <td className="py-2 pr-4 text-fg-soft">{row.templateName}</td>
      <td className="py-2 pr-4 text-fg-soft">{row.gradeLabel ?? ''}</td>
      <td className="py-2 pr-4 text-fg-muted">
        {new Date(row.updatedAt).toLocaleDateString('cs')}
      </td>
      <td className="py-2 pr-0 text-right">
        <TestActions row={row} />
      </td>
    </tr>
  )
}

/**
 * Týž test jako karta — podoba pro telefon. V tabulce by na 390 px zůstaly
 * sloupce s body i celá nabídka akcí za okrajem obrazovky a s testem by nešlo
 * udělat vůbec nic.
 */
export function TestCard({ row }: { row: TestRowData }) {
  return (
    <li className="rounded-[var(--radius-inner)] border border-line-soft p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/tests/${row.id}`}
            className="font-medium break-words text-fg hover:text-brand"
          >
            {row.title}
          </Link>
          <TestBadges row={row} />
        </div>
        <TestActions row={row} />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-fg-soft">
        <span className="ui-numeric">
          {row.questionCount} {otazkyWord(row.questionCount)}
        </span>
        <span aria-hidden="true">·</span>
        <span className="ui-numeric">{row.points} b.</span>
        <span aria-hidden="true">·</span>
        <span>{row.templateName}</span>
        {row.gradeLabel ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{row.gradeLabel}</span>
          </>
        ) : null}
        <span aria-hidden="true">·</span>
        <span className="text-fg-muted">{new Date(row.updatedAt).toLocaleDateString('cs')}</span>
      </p>
    </li>
  )
}
