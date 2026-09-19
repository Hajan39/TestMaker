import { PageShell } from '@testmaker/ui'
import { loadLibraryTree } from '@/lib/library'
import { ImportClient } from './ImportClient'
import { ucetStranky } from '@/lib/uzivatel'

export const metadata = { title: 'Import materiálů – TestMaker' }

// Našeptávané předměty a ročníky musí odpovídat tomu, co v knihovně právě je.
export const dynamic = 'force-dynamic'

export default async function ImportPage() {
  const ucet = await ucetStranky()
  const tree = await loadLibraryTree(ucet)
  // Předměty i ročníky z knihovny se v náhledu našeptávají, aby vedle
  // „Přírodopisu“ nevznikl druhý „PŘÍRODOPIS“ jen kvůli velikosti písmen.
  const library = tree.map((subject) => ({
    subject: subject.name,
    grades: subject.grades.map((grade) => grade.name).filter(Boolean),
  }))

  return (
    <PageShell>
      <div className="space-y-4">
        <div>
          <h1 className="ui-page-title">Import materiálů</h1>
          <p className="mt-1 max-w-3xl text-sm text-fg-soft">
            Vyber složku, jednotlivé soubory, nebo je sem přetáhni. Text se vytáhne přímo
            v prohlížeči, na server se posílá jen text, ne soubory. Ze struktury složek se
            odhadne Předmět → Ročník → Téma — v náhledu si odhad projdeš a opravíš dřív, než
            se cokoli uloží.
          </p>
        </div>
        <ImportClient library={library} />
      </div>
    </PageShell>
  )
}
