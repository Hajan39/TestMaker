import { TestsOverview, type OverviewParams } from './TestsOverview'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Testy – TestMaker' }

export default async function TestsPage({ searchParams }: { searchParams: Promise<OverviewParams> }) {
  return <TestsOverview kind="pisemka" params={await searchParams} />
}
