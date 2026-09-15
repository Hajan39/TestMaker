'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { MoreVertical } from 'lucide-react'
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
            <DropdownMenuItem asChild>
              <a href={`/api/tests/${row.id}/pdf?variant=A`} target="_blank" rel="noreferrer">
                Stáhnout PDF
              </a>
            </DropdownMenuItem>
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
                onClick={(event) => {
                  event.preventDefault()
                  void remove()
                }}
              >
                Smazat
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  )
}
