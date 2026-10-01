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
  pocet,
  toast,
  type PluralForms,
} from '@testmaker/ui'
import { PrintMenuItems } from '@/components/PrintMenu'
import { RowActions } from '@/components/RowActions'
import { errorMessage, requestJson, SERVER_TROUBLE } from '@/lib/requestJson'
import type { TestKind } from '@testmaker/core/schema'
import { testPath } from './paths'

export interface TestRowData {
  id: string
  kind: TestKind
  title: string
  graded: boolean
  variants: number
  questionCount: number
  points: number
  templateName: string
  /** „Předmět · ročník"; `null` u testu bez třídy. */
  gradeLabel: string | null
  /** Téma pracovního listu; `null` u volného zadání (i když téma mezitím zmizelo). */
  topicName: string | null
  /** Všechny položky kromě zalomení strany — u listu se počítají místo otázek. */
  itemCount: number
  /** Vlastní písemka; nasdílenou od kolegyně jde jen otevřít, vytisknout a zkopírovat. */
  mine: boolean
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
    const failure = 'Kopii se nepodařilo vytvořit.'
    try {
      const data = await requestJson<{ id: string }>(
        `/api/tests?copyOf=${encodeURIComponent(row.id)}`,
        { method: 'POST' },
        failure,
      )
      const id = data.id
      if (!id) throw new Error(`${failure} ${SERVER_TROUBLE}`)
      router.refresh()
      toast.success(`Kopie „${row.title} (kopie)“ je hotová.`, {
        duration: 10_000,
        action: { label: 'Otevřít', onClick: () => router.push(testPath(row.kind, id)) },
      })
    } catch (error) {
      toast.error(errorMessage(error, failure))
    } finally {
      setCopying(false)
    }
  }

  async function remove() {
    setDeleting(true)
    const failure = row.kind === 'pracovni_list' ? 'List se nepodařilo smazat.' : 'Test se nepodařilo smazat.'
    try {
      await requestJson(`/api/tests?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' }, failure)
      // Dialog se zavírá jen po úspěchu — po chybě zůstane otevřený a jde to zkusit znovu.
      setConfirmOpen(false)
      toast.success(`„${row.title}“ je smazaný.`)
      router.refresh()
    } catch (error) {
      toast.error(errorMessage(error, failure))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <RowActions label={`${row.kind === 'pracovni_list' ? 'Akce u listu' : 'Akce u testu'} ${row.title}`} busy={pdfWork ?? (copying ? 'Kopíruji…' : null)}>
        <DropdownMenuItem asChild>
          <Link href={testPath(row.kind, row.id)}>{row.mine ? 'Upravit' : 'Otevřít'}</Link>
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
        {/* Smazat smí jen autorka — u nasdílené písemky by server odpověděl „nenašel se“. */}
        {row.mine ? (
          <DropdownMenuItem
            variant="destructive"
            onSelect={(event) => {
              event.preventDefault()
              setConfirmOpen(true)
            }}
          >
            Smazat
          </DropdownMenuItem>
        ) : null}
      </RowActions>
      {pdfError ? <p className="mt-1 text-sm text-danger">{pdfError}</p> : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {row.kind === 'pracovni_list' ? 'Smazat pracovní list' : 'Smazat test'} „{row.title}“?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {row.kind === 'pracovni_list'
                ? 'List se smaže i se všemi položkami.'
                : 'Test se smaže včetně poskládaných položek. Otázky v bance zůstanou zachované.'}{' '}
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

const POLOZKY: PluralForms = ['položka', 'položky', 'položek']

/**
 * Odznáčky testu: na známky / bez známek, případně varianty A/B. List se
 * neznámkuje nikdy — u něj odznáček říká, z čeho vznikl.
 */
function TestBadges({ row }: { row: TestRowData }) {
  if (row.kind === 'pracovni_list') {
    return (
      <div className="mt-1 flex flex-wrap gap-1">
        <Badge variant="secondary">{row.topicName ? `téma: ${row.topicName}` : 'volné zadání'}</Badge>
      </div>
    )
  }
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
        <Link href={testPath(row.kind, row.id)} className="font-medium text-fg hover:text-brand">
          {row.title}
        </Link>
        <TestBadges row={row} />
      </td>
      {row.kind === 'pracovni_list' ? (
        <td className="ui-numeric py-2 pr-4 text-fg-soft">{row.itemCount}</td>
      ) : (
        <>
          <td className="ui-numeric py-2 pr-4 text-fg-soft">{row.questionCount}</td>
          <td className="ui-numeric py-2 pr-4 text-fg-soft">{row.points}</td>
        </>
      )}
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
            href={testPath(row.kind, row.id)}
            className="font-medium break-words text-fg hover:text-brand"
          >
            {row.title}
          </Link>
          <TestBadges row={row} />
        </div>
        <TestActions row={row} />
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-fg-soft">
        {row.kind === 'pracovni_list' ? (
          <span className="ui-numeric">{pocet(row.itemCount, POLOZKY)}</span>
        ) : (
          <>
            <span className="ui-numeric">
              {row.questionCount} {otazkyWord(row.questionCount)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="ui-numeric">{row.points} b.</span>
          </>
        )}
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
