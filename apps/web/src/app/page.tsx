import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Button, EmptyState, OTAZKY, TEMATA, pocet } from '@testmaker/ui'
import { BulkGenerate } from '@/components/BulkGenerate'
import { ClassTiles } from '@/components/ClassTiles'
import { LibraryPanes } from '@/components/LibraryPanes'
import { NewLibraryItem } from '@/components/LibraryItemDialogs'
import { RememberClass } from '@/components/RememberClass'
import { aiStatus } from '@/lib/ai'
import { loadLibraryTree } from '@/lib/library'
import { roleMuzeMenit } from '@/lib/role'
import { ucetStranky } from '@/lib/uzivatel'

export const dynamic = 'force-dynamic'

/**
 * Úvod: rozcestník na třídy, ne strom knihovny. Kdo má naposledy otevřenou
 * třídu zapamatovanou (`RememberClass`), je do ní rovnou přesměrován —
 * dlaždice se ukážou jen prázdné knihovně, cestě „Všechny třídy" (`?vse=1`)
 * a chvíli, než se přesměrování na klientovi stihne spustit.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ vse?: string; grade?: string }>
}) {
  const { vse, grade } = await searchParams
  // Stará adresa knihovny s ročníkem v dotazu (`/?grade=<id>`) vede na jeho
  // novou stránku třídy — jinak by se staré odkazy z rozhraní i uložené
  // v prohlížeči rozsypaly. Existenci třídy ověří až stránka třídy sama.
  if (grade) redirect(`/tridy/${encodeURIComponent(grade)}`)

  const ucet = await ucetStranky()
  const tree = await loadLibraryTree(ucet)
  const muzeMenit = roleMuzeMenit(ucet.role)

  if (tree.length === 0) {
    // `LibraryPanes` bez stromu sloupce sama vynechá — prázdná knihovna tak
    // dostane jen tuhle hlášku přes celou plochu, ne prázdný postranní panel.
    return (
      <EmptyState
        title="Knihovna je zatím prázdná"
        hint={
          muzeMenit
            ? 'Naimportuj složku s materiály — z každého souboru se vytáhne text a vznikne téma. Nebo si založ prázdný předmět a otázky si napiš sama.'
            : 'Zatím v ní nic není.'
        }
        action={
          muzeMenit ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href="/import">
                <Button>Hromadný import</Button>
              </Link>
              <NewLibraryItem kind="subject" label="Založit předmět" size="default" />
            </div>
          ) : undefined
        }
      />
    )
  }

  const knownGradeIds = tree.flatMap((subject) => subject.grades.map((grade) => grade.id))
  const totals = tree.reduce(
    (acc, subject) => {
      for (const grade of subject.grades) {
        for (const topic of grade.topics) {
          acc.topics += 1
          acc.questions += topic.questionCount
        }
      }
      return acc
    },
    { topics: 0, questions: 0 },
  )

  return (
    <LibraryPanes tree={tree} grade={null} contentLabel="Třídy">
      <div className="space-y-5">
        <RememberClass knownGradeIds={knownGradeIds} escape={vse === '1'} userId={ucet.userId} />

        {/* Hledání přes celou knihovnu je teď v postranním panelu (viz
            `LibrarySidebar`) — dvě stejná pole na jedné stránce by měla
            zdvojený popisek a to druhé by mířilo na neviditelnou kopii. */}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="ui-page-title">Třídy</h1>
            <p className="mt-1 text-sm text-fg-soft">
              {pocet(totals.topics, TEMATA)} · {pocet(totals.questions, OTAZKY)}
            </p>
          </div>
          {/* Na úzké obrazovce se akce zalomí pod sebe místo toho, aby vytekly
              z hlavičky — `main` vodorovné rolování skrývá, takže tlačítko za
              okrajem by bylo nedosažitelné. */}
          <div className="flex flex-wrap items-center gap-2">
            {muzeMenit ? (
              <>
                <BulkGenerate
                  ai={aiStatus()}
                  // Rod předmětu se z názvu složky uhodnout nedá („Celý MATEMATIKA“),
                  // tak se do názvu tlačítka přídavné jméno vůbec nedává.
                  scopes={tree.map((subject) => ({ label: `Předmět ${subject.name}`, subjectId: subject.id }))}
                />
                <NewLibraryItem kind="subject" label="Založit předmět" />
                <Link href="/import">
                  <Button size="sm" variant="outline">
                    Hromadný import
                  </Button>
                </Link>
                <Link href="/tests/new">
                  <Button size="sm">Nový test</Button>
                </Link>
              </>
            ) : null}
          </div>
        </div>

        <ClassTiles tree={tree} />
      </div>
    </LibraryPanes>
  )
}
