import { searchLibrary } from '@/lib/library'

export const runtime = 'nodejs'

/** Hledání přes celou knihovnu — nad panelem předmětů a ročníků. */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q') ?? ''
  const results = await searchLibrary(query)
  return Response.json({ results })
}
