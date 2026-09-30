import { TestEditorPage } from '../../tests/TestEditorPage'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Pracovní list – TestMaker' }

export default async function WorksheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ vynechano?: string }>
}) {
  const { id } = await params
  const { vynechano } = await searchParams
  return <TestEditorPage id={id} kind="pracovni_list" vynechano={vynechano} />
}
