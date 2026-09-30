import { TestsOverview, type OverviewParams } from '../tests/TestsOverview'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pracovní listy – TestMaker' }

/**
 * Pracovní listy mají vlastní záložku: jsou to písemky bez známek, které
 * vznikají z tématu i z volného zadání a jejich úlohy do banky nejdou.
 */
export default async function WorksheetsPage({ searchParams }: { searchParams: Promise<OverviewParams> }) {
  return <TestsOverview kind="pracovni_list" params={await searchParams} />
}
