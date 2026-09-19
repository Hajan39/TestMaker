import { searchLibrary } from '@/lib/library'
import { sRozsahem } from '@/lib/uzivatel'

export const runtime = 'nodejs'

/** Hledání přes celou knihovnu školy — nad panelem předmětů a ročníků. */
export async function GET(request: Request) {
  return sRozsahem(async (ucet) => {
    const query = new URL(request.url).searchParams.get('q') ?? ''
    return Response.json({ results: await searchLibrary(ucet, query) })
  })
}
