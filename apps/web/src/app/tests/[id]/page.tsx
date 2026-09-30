import { TestEditorPage } from '../TestEditorPage'

export const dynamic = 'force-dynamic'

export default async function TestPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tema?: string }>
}) {
  const { id } = await params
  const { tema } = await searchParams
  return <TestEditorPage id={id} kind="pisemka" tema={tema} />
}
