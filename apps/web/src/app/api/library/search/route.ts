import { searchLibrary } from '@/lib/library'
import { withScope } from '@/lib/user'

export const runtime = 'nodejs'

/** Search across the school's whole library — above the subjects and grades pane. */
export async function GET(request: Request) {
  return withScope(async (account) => {
    const query = new URL(request.url).searchParams.get('q') ?? ''
    return Response.json({ results: await searchLibrary(account, query) })
  })
}
